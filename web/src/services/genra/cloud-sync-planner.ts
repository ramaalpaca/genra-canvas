// Pure sync planning: given what this browser has and what the server reports, decide what to do.
// No I/O here, so every case is unit-tested in tests/cloud-sync-planner.test.ts.

export type ServerProjectMeta = {
    id: string;
    title: string;
    revision: number;
    node_count: number;
    data_bytes: number;
    client_updated_at: string | null;
    updated_at: string;
    created_at: string;
    deleted_at: string | null;
};

/** What this browser knows about a project's cloud copy. */
export type KnownProject = {
    revision: number;
    /** Local `updatedAt` of the version that matches `revision`. Anything newer has unsynced edits. */
    localUpdatedAt: string;
    deleted?: boolean;
    /** Local `updatedAt` that the server refused as too large; retried only once the project changes. */
    blockedUpdatedAt?: string;
};

export type PlanInput = {
    localProjects: { id: string; updatedAt: string }[];
    /** Ids in the canvas store's `deletedProjects`, i.e. removed from this browser. */
    localTombstones: string[];
    known: Record<string, KnownProject>;
    serverProjects: ServerProjectMeta[];
    /** True for an unfiltered GET /projects: a known id missing from it no longer exists on the server. */
    serverListComplete: boolean;
    /** Projects another account synced from this browser; never upload them under the current account. */
    excludeIds?: Iterable<string>;
};

export type SyncPlan = {
    /** PUT these. `baseRevision` undefined means the server should not have the project yet. */
    push: { id: string; baseRevision?: number }[];
    /** GET these and overwrite local. `expectedUpdatedAt` guards against edits made after planning. */
    pull: { id: string; expectedUpdatedAt: string | null }[];
    /** DELETE these on the server. */
    deleteRemote: string[];
    /** Server tombstones to apply locally. */
    deleteLocal: { id: string; revision: number }[];
    /** Same content on both sides but no local record (sync state was lost): record it, transfer nothing. */
    adopt: { id: string; revision: number; localUpdatedAt: string }[];
};

function time(value: string | null | undefined) {
    const parsed = value ? Date.parse(value) : Number.NaN;
    return Number.isNaN(parsed) ? 0 : parsed;
}

export function planCloudSync({ localProjects, localTombstones, known, serverProjects, serverListComplete, excludeIds }: PlanInput): SyncPlan {
    const plan: SyncPlan = { push: [], pull: [], deleteRemote: [], deleteLocal: [], adopt: [] };
    const server = new Map(serverProjects.map((meta) => [meta.id, meta]));
    const local = new Set(localProjects.map((project) => project.id));
    const tombstones = new Set(localTombstones.filter((id) => !local.has(id)));
    const excluded = new Set(excludeIds);

    for (const project of localProjects) {
        const record = known[project.id];
        const meta = server.get(project.id);
        if (!record && !meta && excluded.has(project.id)) continue;
        if (record?.blockedUpdatedAt === project.updatedAt && !(meta && meta.revision > record.revision)) continue;
        const dirty = !record || time(project.updatedAt) > time(record.localUpdatedAt);
        const expectedUpdatedAt = project.updatedAt;

        if (!record) {
            if (meta && !meta.deleted_at && time(meta.client_updated_at) === time(project.updatedAt)) plan.adopt.push({ id: project.id, revision: meta.revision, localUpdatedAt: project.updatedAt });
            // A different server copy makes the base-less PUT answer 409, which runs the normal conflict path.
            else plan.push.push({ id: project.id });
            continue;
        }
        if (meta) {
            const serverAhead = meta.revision > record.revision;
            if (dirty) plan.push.push({ id: project.id, baseRevision: record.revision });
            else if (meta.deleted_at) plan.deleteLocal.push({ id: project.id, revision: meta.revision });
            else if (serverAhead) plan.pull.push({ id: project.id, expectedUpdatedAt });
            continue;
        }
        if (record.deleted) {
            if (dirty) plan.push.push({ id: project.id, baseRevision: record.revision });
            else plan.deleteLocal.push({ id: project.id, revision: record.revision });
        } else if (serverListComplete) {
            // The server no longer has it at all, so upload it again from scratch.
            plan.push.push({ id: project.id });
        } else if (dirty) {
            plan.push.push({ id: project.id, baseRevision: record.revision });
        }
    }

    for (const id of tombstones) {
        const record = known[id];
        const meta = server.get(id);
        if (record?.deleted) {
            // Deleted on both sides, unless another device restored it afterwards.
            if (meta && !meta.deleted_at && meta.revision > record.revision) plan.pull.push({ id, expectedUpdatedAt: null });
        } else if (record || (meta && !meta.deleted_at)) {
            plan.deleteRemote.push(id);
        }
    }

    for (const meta of serverProjects) {
        if (local.has(meta.id) || tombstones.has(meta.id)) continue;
        if (meta.deleted_at) {
            if (known[meta.id] && !known[meta.id].deleted) plan.deleteLocal.push({ id: meta.id, revision: meta.revision });
        } else {
            plan.pull.push({ id: meta.id, expectedUpdatedAt: null });
        }
    }

    return plan;
}

export function isPlanEmpty(plan: SyncPlan) {
    return !plan.push.length && !plan.pull.length && !plan.deleteRemote.length && !plan.deleteLocal.length && !plan.adopt.length;
}

/** Largest `updated_at`, used as the next `since`. Server timestamps are all UTC ISO strings, so text order is time order. */
export function nextSinceCursor(current: string | null, serverProjects: ServerProjectMeta[]) {
    return serverProjects.reduce<string | null>((latest, meta) => (!latest || meta.updated_at > latest ? meta.updated_at : latest), current);
}

/**
 * Object URLs only mean something inside one page load, yet they sit in node metadata. Collapse them to a constant:
 * still truthy, which the page's hydrate step needs before it restores the real URL from `storageKey`.
 */
export function stripObjectUrls(_key: string, value: unknown) {
    return typeof value === "string" && value.startsWith("blob:") ? "blob:" : value;
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (!value || typeof value !== "object") return value;
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
        Object.keys(source)
            .sort()
            .map((key) => [key, sortKeys(source[key])]),
    );
}

/**
 * Stable text for "did the content change". The canvas page rewrites `updatedAt` just by opening a project, and pan/zoom
 * rewrites it too, so a timestamp alone would upload a new revision for every look and bounce between devices.
 */
export function projectContentSource(project: object) {
    const { updatedAt: _updatedAt, viewport: _viewport, ...content } = project as Record<string, unknown>;
    return JSON.stringify(sortKeys(JSON.parse(JSON.stringify(content, stripObjectUrls))));
}
