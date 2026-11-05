// Canvas cloud sync, wired to the app: scheduling, per-account sync state, status for the UI, and on-demand file fetching.
// The cycle itself is in cloud-sync-engine.ts. Nothing here may block canvas work: everything is async, and failures only
// update the status and back off.
import localforage from "localforage";
import { nanoid } from "nanoid";
import { create } from "zustand";

import i18n from "@/i18n";
import { collectMediaStorageKeys, getMediaBlob, setMediaBlob, setRemoteMediaResolver } from "@/services/file-storage";
import { collectImageStorageKeys, getImageBlob, setImageBlob, setRemoteImageResolver } from "@/services/image-storage";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";

import { isCanvasAccessEnabled, useCanvasAccess } from "./access";
import { getGenraAccessToken, useGenraAuth } from "./auth";
import { CloudSyncError, createCloudClient, type CloudUsage } from "./cloud-sync-client";
import { createCloudSyncEngine, emptyCloudSyncState, type CloudSyncLocal, type CloudSyncNotice, type CloudSyncState } from "./cloud-sync-engine";
import { GENRA_API_URL, GENRA_CLOUD_SYNC_ENABLED } from "./env";
import { resetSyncErrorStreak, trackSyncError } from "./tracker";

const PUSH_DEBOUNCE_MS = 3_000;
const POLL_INTERVAL_MS = 60_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;
/** Opening a canvas waits for its files, so give up waiting after this; the download carries on and is cached for next time. */
const REMOTE_FILE_WAIT_MS = 15_000;
const REMOTE_FILE_CONCURRENCY = 4;
const REMOTE_FILE_MISS_TTL_MS = 60_000;
const STORAGE_KEY_PATTERN = /^[A-Za-z0-9_:-]{1,128}$/;
const SYNC_LOCK = "genra-canvas-cloud-sync";

export type CloudSyncPhase = "disabled" | "syncing" | "synced" | "offline" | "error";

type CloudSyncStatus = {
    phase: CloudSyncPhase;
    lastSyncedAt: string | null;
    usage: CloudUsage | null;
    notices: CloudSyncNotice[];
    /** Bumped when sync replaces or removes a project, so an open canvas page reloads it. */
    reloadTokens: Record<string, number>;
};

export const useCloudSyncStatus = create<CloudSyncStatus>()(() => ({ phase: "disabled", lastSyncedAt: null, usage: null, notices: [], reloadTokens: {} }));

export const useCloudSyncActive = () => useCloudSyncStatus((state) => state.phase !== "disabled");
export const useCloudProjectReloadToken = (projectId: string) => useCloudSyncStatus((state) => state.reloadTokens[projectId] ?? 0);

export function takeCloudSyncNotices() {
    const { notices } = useCloudSyncStatus.getState();
    if (notices.length) useCloudSyncStatus.setState({ notices: [] });
    return notices;
}

const stateStore = localforage.createInstance({ name: "infinite-canvas", storeName: "genra_cloud_sync" });
const client = createCloudClient({ baseUrl: `${GENRA_API_URL}/api/v1/canvas`, getToken: getGenraAccessToken });

function requestProjectReload(id: string) {
    useCloudSyncStatus.setState((state) => ({ reloadTokens: { ...state.reloadTokens, [id]: (state.reloadTokens[id] ?? 0) + 1 } }));
}

const local: CloudSyncLocal = {
    getProjects: () => useCanvasStore.getState().projects,
    getTombstones: () => useCanvasStore.getState().deletedProjects.map((item) => item.id),
    applyRemoteProject: (project, expectedUpdatedAt) => {
        const { projects, deletedProjects } = useCanvasStore.getState();
        const existing = projects.find((item) => item.id === project.id);
        if (expectedUpdatedAt !== null && existing?.updatedAt !== expectedUpdatedAt) return false;
        useCanvasStore.setState({
            projects: existing ? projects.map((item) => (item.id === project.id ? project : item)) : [project, ...projects],
            deletedProjects: deletedProjects.filter((item) => item.id !== project.id),
        });
        if (existing) requestProjectReload(project.id);
        return true;
    },
    removeProject: (id) => {
        useCanvasStore.getState().deleteProjects([id]);
        requestProjectReload(id);
    },
    insertProject: (project) => useCanvasStore.setState((state) => ({ projects: [project, ...state.projects] })),
    replaceProjectId: (id, newId) => {
        useCanvasStore.setState((state) => ({ projects: state.projects.map((project) => (project.id === id ? { ...project, id: newId } : project)) }));
        requestProjectReload(id);
    },
    fileKeys: (project: CanvasProject) => [...new Set([...collectImageStorageKeys(project), ...collectMediaStorageKeys(project)])],
    readBlob: (key) => (key.startsWith("image:") ? getImageBlob(key, { localOnly: true }) : getMediaBlob(key, { localOnly: true })),
    newId: () => nanoid(),
    copyTitle: (title) => i18n.t("genra.cloudSync.localCopyTitle", { title }),
};

function withSyncLock<T>(task: () => Promise<T>) {
    // Tabs share sync state on disk; running one cycle at a time keeps them from racing on revisions.
    return navigator.locks ? (navigator.locks.request(SYNC_LOCK, task) as Promise<T>) : task();
}

type Session = { dispose: () => void };
let session: Session | null = null;

function startSession(userId: string): Session {
    const stateKey = `user:${userId}`;
    let disposed = false;
    let running = false;
    let queuedRemote: boolean | null = null;
    let failures = 0;
    let retryAt = 0;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let excludedIds: Promise<Set<string>> | null = null;

    const loadExcludedIds = () =>
        (excludedIds ??= (async () => {
            const ids = new Set<string>();
            await stateStore.iterate<CloudSyncState, void>((value, key) => {
                if (key !== stateKey) Object.keys(value.projects).forEach((id) => ids.add(id));
            });
            return ids;
        })());

    const engine = createCloudSyncEngine({
        client,
        local,
        loadState: async () => ({ ...emptyCloudSyncState(), ...(await stateStore.getItem<CloudSyncState>(stateKey)) }),
        saveState: async (state) => {
            await stateStore.setItem(stateKey, state);
            useCloudSyncStatus.setState({ lastSyncedAt: state.lastSyncedAt });
        },
        loadExcludedIds,
        notify: (notice) => useCloudSyncStatus.setState((state) => ({ notices: [...state.notices, notice] })),
        onBusy: () => useCloudSyncStatus.setState({ phase: "syncing" }),
        onUsage: (usage) => useCloudSyncStatus.setState({ usage }),
    });

    const schedulePoll = () => {
        clearTimeout(pollTimer);
        if (!disposed) pollTimer = setTimeout(() => void execute(true), failures ? Math.max(retryAt - Date.now(), 0) : POLL_INTERVAL_MS);
    };

    const execute = async (remote: boolean) => {
        if (disposed) return;
        if (running) {
            queuedRemote = Boolean(queuedRemote) || remote;
            return;
        }
        running = true;
        try {
            await withSyncLock(() => engine.run({ remote }));
            failures = 0;
            retryAt = 0;
            resetSyncErrorStreak();
            if (!disposed) useCloudSyncStatus.setState({ phase: "synced" });
        } catch (error) {
            failures += 1;
            retryAt = Date.now() + Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
            const network = !navigator.onLine || (error instanceof CloudSyncError && error.isNetworkError);
            if (!disposed) useCloudSyncStatus.setState({ phase: network ? "offline" : "error" });
            console.warn("[genra] canvas sync failed", error);
            trackSyncError(error, failures);
        } finally {
            running = false;
            const next = queuedRemote;
            queuedRemote = null;
            if (next !== null && !failures) void execute(next);
            else schedulePoll();
        }
    };

    const unsubscribeCanvas = useCanvasStore.subscribe((state, previous) => {
        if (state.projects === previous.projects && state.deletedProjects === previous.deletedProjects) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (Date.now() >= retryAt) void execute(false);
        }, PUSH_DEBOUNCE_MS);
    });
    const onFocus = () => {
        if (Date.now() >= retryAt) void execute(true);
    };
    const onOnline = () => {
        failures = 0;
        retryAt = 0;
        void execute(true);
    };
    const onOffline = () => useCloudSyncStatus.setState({ phase: "offline" });
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    useCloudSyncStatus.setState({ phase: "syncing", usage: null, lastSyncedAt: null });
    void stateStore.getItem<CloudSyncState>(stateKey).then((state) => {
        if (!disposed && state) useCloudSyncStatus.setState({ lastSyncedAt: state.lastSyncedAt });
    });
    void execute(true);

    return {
        dispose: () => {
            disposed = true;
            clearTimeout(pollTimer);
            clearTimeout(debounceTimer);
            unsubscribeCanvas();
            window.removeEventListener("focus", onFocus);
            window.removeEventListener("online", onOnline);
            window.removeEventListener("offline", onOffline);
            useCloudSyncStatus.setState({ phase: "disabled" });
        },
    };
}

/** Limit concurrent file downloads: opening a canvas asks for all of its files at once. */
const downloadQueue: (() => void)[] = [];
let activeDownloads = 0;

async function withDownloadSlot<T>(task: () => Promise<T>) {
    if (activeDownloads >= REMOTE_FILE_CONCURRENCY) await new Promise<void>((resolve) => downloadQueue.push(resolve));
    activeDownloads += 1;
    try {
        return await task();
    } finally {
        activeDownloads -= 1;
        downloadQueue.shift()?.();
    }
}

const remoteDownloads = new Map<string, Promise<Blob | null>>();
const remoteMisses = new Map<string, number>();

/** A canvas opened by direct URL can ask for files before the session has been restored. */
function whenAuthResolved() {
    return new Promise<void>((resolve) => {
        if (useGenraAuth.getState().session !== undefined) return resolve();
        const unsubscribe = useGenraAuth.subscribe((state) => {
            if (state.session === undefined) return;
            unsubscribe();
            resolve();
        });
    });
}

async function resolveRemoteFile(storageKey: string, save: (key: string, blob: Blob) => Promise<unknown>): Promise<Blob | null> {
    await whenAuthResolved();
    // Previews and URLs ask repeatedly, so remember misses instead of hitting the API on every render.
    if (!useGenraAuth.getState().user || !isCanvasAccessEnabled() || !STORAGE_KEY_PATTERN.test(storageKey) || (remoteMisses.get(storageKey) ?? 0) > Date.now()) return null;
    let download = remoteDownloads.get(storageKey);
    if (!download) {
        download = withDownloadSlot(() => client.downloadFile(storageKey))
            .then(async (blob) => {
                if (blob) await save(storageKey, blob);
                else remoteMisses.set(storageKey, Date.now() + REMOTE_FILE_MISS_TTL_MS);
                return blob;
            })
            .catch(() => {
                remoteMisses.set(storageKey, Date.now() + REMOTE_FILE_MISS_TTL_MS);
                return null;
            })
            .finally(() => remoteDownloads.delete(storageKey));
        remoteDownloads.set(storageKey, download);
    }
    return Promise.race([download, new Promise<null>((resolve) => setTimeout(() => resolve(null), REMOTE_FILE_WAIT_MS))]);
}

/** App bootstrap. Follows the signed-in user; each account gets its own sync state. */
export function startCloudSync() {
    if (!GENRA_CLOUD_SYNC_ENABLED) return;
    setRemoteImageResolver((key) => resolveRemoteFile(key, setImageBlob));
    setRemoteMediaResolver((key) => resolveRemoteFile(key, setMediaBlob));

    let currentUserId: string | null = null;
    const update = () => {
        const userId = useCanvasStore.getState().hydrated && isCanvasAccessEnabled() ? (useGenraAuth.getState().user?.id ?? null) : null;
        if (userId === currentUserId) return;
        currentUserId = userId;
        session?.dispose();
        session = userId ? startSession(userId) : null;
    };
    useGenraAuth.subscribe(update);
    useCanvasStore.subscribe(update);
    useCanvasAccess.subscribe(update);
    update();
}
