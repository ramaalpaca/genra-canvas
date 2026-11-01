// One sync cycle: plan, then delete, pull and push. Stores, timers and UI are injected by cloud-sync.ts,
// which keeps this file free of browser state and lets tests drive it with a mock fetch.
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

import { CloudSyncError, type CloudClient, type CloudUsage, type ServerProjectDetail } from "./cloud-sync-client";
import { isPlanEmpty, nextSinceCursor, planCloudSync, projectContentSource, type KnownProject, type ServerProjectMeta } from "./cloud-sync-planner";

/** The API allows 100 MiB but Cloudflare can drop such requests with no CORS headers, so stop short of it. */
export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;
const QUOTA_NOTICE_COOLDOWN_MS = 60 * 60_000;
const STORAGE_KEY_PATTERN = /^[A-Za-z0-9_:-]{1,128}$/;

export type CloudProjectState = KnownProject & {
    contentHash?: string;
    /** Some referenced files could not be uploaded (quota); retried on later remote cycles. */
    filesIncomplete?: boolean;
};

export type CloudSyncState = {
    since: string | null;
    lastSyncedAt: string | null;
    projects: Record<string, CloudProjectState>;
};

export type CloudSyncNotice =
    | { kind: "conflict"; title: string; copyTitle: string }
    | { kind: "conflictDeleted"; title: string; copyTitle: string }
    | { kind: "quotaExceeded" }
    | { kind: "fileTooLarge"; megabytes: number }
    | { kind: "projectTooLarge"; title: string };

export type CloudSyncLocal = {
    getProjects: () => CanvasProject[];
    getTombstones: () => string[];
    /** Overwrite or insert. Returns false when local changed since `expectedUpdatedAt`, leaving it untouched. */
    applyRemoteProject: (project: CanvasProject, expectedUpdatedAt: string | null) => boolean;
    removeProject: (id: string) => void;
    insertProject: (project: CanvasProject) => void;
    replaceProjectId: (id: string, newId: string) => void;
    fileKeys: (project: CanvasProject) => string[];
    readBlob: (storageKey: string) => Promise<Blob | null>;
    newId: () => string;
    copyTitle: (title: string) => string;
};

export type CloudSyncEngineOptions = {
    client: CloudClient;
    local: CloudSyncLocal;
    loadState: () => Promise<CloudSyncState>;
    saveState: (state: CloudSyncState) => Promise<void>;
    /** Project ids other accounts synced from this browser. */
    loadExcludedIds?: () => Promise<Iterable<string>>;
    notify?: (notice: CloudSyncNotice) => void;
    onBusy?: () => void;
    onUsage?: (usage: CloudUsage) => void;
    now?: () => Date;
};

export function emptyCloudSyncState(): CloudSyncState {
    return { since: null, lastSyncedAt: null, projects: {} };
}

async function contentHash(project: CanvasProject) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(projectContentSource(project)));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createCloudSyncEngine({ client, local, loadState, saveState, loadExcludedIds, notify, onBusy, onUsage, now = () => new Date() }: CloudSyncEngineOptions) {
    let reconciled = false;
    let quotaNoticeAt = 0;
    const oversizeNotified = new Set<string>();
    const findLocal = (id: string) => local.getProjects().find((project) => project.id === id);

    const noticeQuota = () => {
        if (now().getTime() - quotaNoticeAt < QUOTA_NOTICE_COOLDOWN_MS) return;
        quotaNoticeAt = now().getTime();
        notify?.({ kind: "quotaExceeded" });
    };
    const noticeOversize = (key: string, bytes: number) => {
        if (oversizeNotified.has(key)) return;
        oversizeNotified.add(key);
        notify?.({ kind: "fileTooLarge", megabytes: Math.ceil(bytes / 1024 / 1024) });
    };

    /** Upload what the server lacks. Returns false if files remain to retry; network errors propagate and abort the push. */
    const uploadFiles = async (project: CanvasProject) => {
        const keys = local.fileKeys(project).filter((key) => STORAGE_KEY_PATTERN.test(key));
        if (!keys.length) return true;
        const present = await client.existingFiles(keys);
        for (const key of keys) {
            if (present.has(key)) continue;
            const blob = await local.readBlob(key);
            if (!blob) continue;
            if (blob.size > MAX_UPLOAD_BYTES) {
                noticeOversize(key, blob.size);
                continue;
            }
            try {
                await client.uploadFile(key, blob);
            } catch (error) {
                if (error instanceof CloudSyncError && error.code === "storage_quota_exceeded") {
                    noticeQuota();
                    return false;
                }
                if (error instanceof CloudSyncError && error.code === "file_too_large") {
                    noticeOversize(key, blob.size);
                    continue;
                }
                throw error;
            }
        }
        return true;
    };

    /** Server timestamps from another device's clock may be ahead of this one, which would hide local edits made after the pull. */
    const clampToNow = (value: string | null | undefined) => {
        const current = now().toISOString();
        return value && Date.parse(value) <= Date.parse(current) ? value : current;
    };

    const toLocalProject = (detail: ServerProjectDetail): CanvasProject => {
        const remote = (detail.project && typeof detail.project === "object" ? detail.project : {}) as Partial<CanvasProject>;
        return {
            createdAt: detail.created_at,
            nodes: [],
            connections: [],
            chatSessions: [],
            activeChatId: null,
            backgroundMode: "lines",
            showImageInfo: false,
            ...remote,
            // Where you were looking is per device, so an open canvas keeps its own view.
            viewport: findLocal(detail.id)?.viewport ?? remote.viewport ?? { x: 0, y: 0, k: 1 },
            id: detail.id,
            title: detail.title || remote.title || "",
            updatedAt: clampToNow(remote.updatedAt ?? detail.client_updated_at),
        };
    };

    const applyTombstone = async (state: CloudSyncState, id: string, revision: number) => {
        local.removeProject(id);
        state.projects[id] = { revision, localUpdatedAt: now().toISOString(), deleted: true };
        await saveState(state);
    };

    const applyDetail = async (state: CloudSyncState, detail: ServerProjectDetail, expectedUpdatedAt: string | null) => {
        if (detail.deleted_at) return applyTombstone(state, detail.id, detail.revision);
        const project = toLocalProject(detail);
        if (!local.applyRemoteProject(project, expectedUpdatedAt)) return;
        state.projects[detail.id] = { revision: detail.revision, localUpdatedAt: project.updatedAt, contentHash: await contentHash(project) };
        await saveState(state);
    };

    /** Keep the local version as a new canvas, then let the server version take over the original id. */
    const resolveConflict = async (state: CloudSyncState, id: string, server: ServerProjectMeta | undefined) => {
        const detail = server?.deleted_at ? null : await client.getProject(id);
        const current = findLocal(id);
        if (!current) return;
        const copy: CanvasProject = { ...current, id: local.newId(), title: local.copyTitle(current.title), updatedAt: now().toISOString() };
        local.insertProject(copy);
        if (detail) await applyDetail(state, detail, null);
        else await applyTombstone(state, id, server?.revision ?? state.projects[id]?.revision ?? 0);
        notify?.({ kind: detail && !detail.deleted_at ? "conflict" : "conflictDeleted", title: current.title, copyTitle: copy.title });
    };

    const pushProject = async (state: CloudSyncState, id: string, baseRevision: number | undefined) => {
        const project = findLocal(id);
        if (!project) return;
        const filesComplete = await uploadFiles(project);
        const hash = await contentHash(project);
        try {
            const meta = await client.putProject(id, { title: project.title, ...(baseRevision === undefined ? {} : { base_revision: baseRevision }), client_updated_at: project.updatedAt, project });
            state.projects[id] = { revision: meta.revision, localUpdatedAt: project.updatedAt, contentHash: hash, ...(filesComplete ? {} : { filesIncomplete: true }) };
            await saveState(state);
        } catch (error) {
            if (!(error instanceof CloudSyncError)) throw error;
            if (error.status === 409) return resolveConflict(state, id, error.body.server as ServerProjectMeta | undefined);
            if (error.status === 404) return local.replaceProjectId(id, local.newId()); // The id belongs to another account; only a new id can be saved.
            if (error.code !== "project_too_large") throw error;
            state.projects[id] = { ...(state.projects[id] ?? { revision: 0, localUpdatedAt: "" }), blockedUpdatedAt: project.updatedAt };
            await saveState(state);
            notify?.({ kind: "projectTooLarge", title: project.title });
        }
    };

    const deleteRemote = async (state: CloudSyncState, id: string) => {
        try {
            const meta = await client.deleteProject(id);
            state.projects[id] = { revision: meta.revision, localUpdatedAt: now().toISOString(), deleted: true };
        } catch (error) {
            if (!(error instanceof CloudSyncError) || error.status !== 404) throw error;
            delete state.projects[id]; // Never reached the server, or belongs to another account: nothing left to delete.
        }
        await saveState(state);
    };

    /** Page opens and pan/zoom touch `updatedAt` without changing content. Absorb those so they neither upload nor conflict. */
    const absorbUnchangedProjects = async (state: CloudSyncState) => {
        for (const project of local.getProjects()) {
            const record = state.projects[project.id];
            if (!record?.contentHash || Date.parse(project.updatedAt) <= Date.parse(record.localUpdatedAt)) continue;
            if ((await contentHash(project)) === record.contentHash) record.localUpdatedAt = project.updatedAt;
        }
    };

    const retryIncompleteFiles = async (state: CloudSyncState) => {
        for (const [id, record] of Object.entries(state.projects)) {
            const project = record.filesIncomplete ? findLocal(id) : undefined;
            if (!project || !(await uploadFiles(project))) continue;
            delete record.filesIncomplete;
            await saveState(state);
        }
    };

    return {
        /** `remote` asks the server what changed; without it the cycle only sends local changes and is network-free when there are none. */
        async run({ remote }: { remote: boolean }) {
            const state = await loadState();
            await absorbUnchangedProjects(state);

            const fullList = remote && !reconciled;
            const response = remote ? await client.listProjects(fullList ? undefined : state.since) : null;
            const serverProjects = response?.projects ?? [];
            if (response) onUsage?.(response.usage);

            const plan = planCloudSync({
                localProjects: local.getProjects(),
                localTombstones: local.getTombstones(),
                known: state.projects,
                serverProjects,
                serverListComplete: fullList,
                excludeIds: await loadExcludedIds?.(),
            });
            if (!isPlanEmpty(plan)) onBusy?.();

            for (const item of plan.adopt) state.projects[item.id] = { revision: item.revision, localUpdatedAt: item.localUpdatedAt };
            for (const item of plan.deleteLocal) await applyTombstone(state, item.id, item.revision);
            for (const id of plan.deleteRemote) await deleteRemote(state, id);
            for (const item of plan.pull) await applyDetail(state, await client.getProject(item.id), item.expectedUpdatedAt);
            for (const item of plan.push) await pushProject(state, item.id, item.baseRevision);
            if (remote) await retryIncompleteFiles(state);

            // Advance the cursor last: an aborted cycle lists the same changes again, and every step above is safe to repeat.
            if (response) {
                state.since = nextSinceCursor(state.since, serverProjects);
                reconciled = true;
            }
            if (response || !isPlanEmpty(plan)) state.lastSyncedAt = now().toISOString();
            await saveState(state);
            return plan;
        },
    };
}
