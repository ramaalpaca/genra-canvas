import { beforeEach, describe, expect, test } from "bun:test";

import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";
import { createCloudClient } from "../src/services/genra/cloud-sync-client";
import { MAX_UPLOAD_BYTES, createCloudSyncEngine, emptyCloudSyncState, type CloudSyncNotice, type CloudSyncState } from "../src/services/genra/cloud-sync-engine";

const T1 = "2026-11-02T08:00:00.000Z";
const T2 = "2026-11-02T09:00:00.000Z";
const NOW = "2026-11-02T12:00:00.000Z";

function project(id: string, extra: Partial<CanvasProject> = {}): CanvasProject {
    return { id, title: id, createdAt: T1, updatedAt: T1, nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 }, ...extra };
}

function meta(id: string, revision: number, extra: Record<string, unknown> = {}) {
    return { id, title: id, revision, node_count: 0, data_bytes: 0, client_updated_at: T1, updated_at: "2026-11-02T08:00:01+00:00", created_at: T1, deleted_at: null, ...extra };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const emptyList = { projects: [], usage: { bytes_used: 1, bytes_limit: 2 } };

type Route = (url: string, init: RequestInit) => Response | Promise<Response> | undefined;

function harness() {
    const h = {
        projects: [] as CanvasProject[],
        tombstones: [] as string[],
        blobs: new Map<string, Blob>(),
        state: emptyCloudSyncState() as CloudSyncState,
        notices: [] as CloudSyncNotice[],
        calls: [] as { method: string; path: string; body?: Record<string, unknown> }[],
        routes: [] as Route[],
        ids: 0,
    };
    const client = createCloudClient({
        baseUrl: "https://api.test",
        getToken: () => "jwt",
        fetchImpl: (async (url: string, init: RequestInit = {}) => {
            const path = url.replace("https://api.test", "");
            const method = init.method ?? "GET";
            h.calls.push({ method, path, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
            for (const route of h.routes) {
                const response = await route(`${method} ${path}`, init);
                if (response) return response;
            }
            if (method === "GET" && path.startsWith("/projects?")) return json(emptyList);
            if (method === "GET" && path === "/projects") return json(emptyList);
            if (path === "/files/exists") return json({ present: [] });
            if (path === "/files") return json({ storage_key: "k", bytes: 1, mime_type: "x" });
            if (method === "PUT") return json(meta(path.replace("/projects/", ""), 1));
            throw new Error(`unrouted ${method} ${path}`);
        }) as typeof fetch,
    });
    const engine = createCloudSyncEngine({
        client,
        local: {
            getProjects: () => h.projects,
            getTombstones: () => h.tombstones,
            applyRemoteProject: (next, expected) => {
                const existing = h.projects.find((item) => item.id === next.id);
                if (expected !== null && existing?.updatedAt !== expected) return false;
                h.projects = existing ? h.projects.map((item) => (item.id === next.id ? next : item)) : [next, ...h.projects];
                h.tombstones = h.tombstones.filter((id) => id !== next.id);
                return true;
            },
            removeProject: (id) => {
                h.projects = h.projects.filter((item) => item.id !== id);
                h.tombstones.push(id);
            },
            insertProject: (next) => {
                h.projects = [next, ...h.projects];
            },
            replaceProjectId: (id, newId) => {
                h.projects = h.projects.map((item) => (item.id === id ? { ...item, id: newId } : item));
            },
            fileKeys: (item) => item.nodes.flatMap((node) => (node.metadata?.storageKey ? [node.metadata.storageKey] : [])),
            readBlob: async (key) => h.blobs.get(key) ?? null,
            newId: () => `new-${++h.ids}`,
            copyTitle: (title) => `${title} (local copy)`,
        },
        loadState: async () => h.state,
        saveState: async (state) => {
            h.state = state;
        },
        notify: (notice) => h.notices.push(notice),
        now: () => new Date(NOW),
    });
    return { h, engine };
}

function withFile(id: string, storageKey: string) {
    return project(id, { nodes: [{ id: "n", metadata: { storageKey } }] as unknown as CanvasProject["nodes"] });
}

let h: ReturnType<typeof harness>["h"];
let engine: ReturnType<typeof harness>["engine"];
const paths = (method: string) => h.calls.filter((call) => call.method === method).map((call) => call.path);

beforeEach(() => {
    ({ h, engine } = harness());
});

describe("push", () => {
    test("uploads missing files, then saves the project", async () => {
        h.projects = [withFile("a", "image:1")];
        h.blobs.set("image:1", new Blob(["x"]));
        await engine.run({ remote: false });
        expect(h.calls.map((call) => `${call.method} ${call.path}`)).toEqual(["POST /files/exists", "POST /files", "PUT /projects/a"]);
        expect(h.state.projects.a.revision).toBe(1);
        expect(h.state.projects.a.localUpdatedAt).toBe(T1);
    });

    test("skips files the server already has", async () => {
        h.projects = [withFile("a", "image:1")];
        h.blobs.set("image:1", new Blob(["x"]));
        h.routes.push((route) => (route === "POST /files/exists" ? json({ present: ["image:1"] }) : undefined));
        await engine.run({ remote: false });
        expect(paths("POST")).toEqual(["/files/exists"]);
        expect(paths("PUT")).toEqual(["/projects/a"]);
    });

    test("a network failure during upload leaves the project unsaved so it retries", async () => {
        h.projects = [withFile("a", "image:1")];
        h.blobs.set("image:1", new Blob(["x"]));
        h.routes.push((route) => (route === "POST /files" ? Promise.reject(new TypeError("Failed to fetch")) : undefined));
        await expect(engine.run({ remote: false })).rejects.toMatchObject({ isNetworkError: true });
        expect(paths("PUT")).toEqual([]);
        expect(h.state.projects.a).toBeUndefined();
    });

    test("no network at all when nothing changed", async () => {
        h.projects = [project("a")];
        await engine.run({ remote: false });
        h.calls.length = 0;
        h.projects = [{ ...h.projects[0], updatedAt: T2, viewport: { x: 5, y: 5, k: 2 } }];
        await engine.run({ remote: false });
        expect(h.calls).toEqual([]);
        expect(h.state.projects.a.localUpdatedAt).toBe(T2);
    });

    test("a page open that only rewrites object URLs does not create a revision", async () => {
        h.projects = [project("a", { nodes: [{ id: "n", metadata: { content: "blob:http://x/1" } }] as unknown as CanvasProject["nodes"] })];
        await engine.run({ remote: false });
        h.calls.length = 0;
        h.projects = [project("a", { updatedAt: T2, nodes: [{ id: "n", metadata: { content: "blob:http://x/2" } }] as unknown as CanvasProject["nodes"] })];
        await engine.run({ remote: false });
        expect(h.calls).toEqual([]);
    });
});

describe("413", () => {
    beforeEach(() => {
        h.projects = [withFile("a", "image:1")];
        h.blobs.set("image:1", new Blob(["x"]));
        h.routes.push((route) => (route === "POST /files" ? json({ error: "storage_quota_exceeded", message: "full" }, 413) : undefined));
    });

    test("quota exceeded warns and still saves the project JSON", async () => {
        await engine.run({ remote: false });
        expect(h.notices).toEqual([{ kind: "quotaExceeded" }]);
        expect(paths("PUT")).toEqual(["/projects/a"]);
        expect(h.state.projects.a.filesIncomplete).toBe(true);
    });

    test("skipped files are retried on later remote cycles and the warning is not repeated", async () => {
        await engine.run({ remote: false });
        await engine.run({ remote: true });
        expect(h.notices).toHaveLength(1);
        h.routes.length = 0;
        await engine.run({ remote: true });
        expect(h.state.projects.a.filesIncomplete).toBeUndefined();
    });
});

test("a project over the JSON limit warns and waits until it changes", async () => {
    h.projects = [project("a")];
    h.routes.push((route) => (route === "PUT /projects/a" ? json({ error: "project_too_large", message: "big" }, 413) : undefined));
    await engine.run({ remote: false });
    await engine.run({ remote: false });
    expect(h.notices).toEqual([{ kind: "projectTooLarge", title: "a" }]);
    expect(paths("PUT")).toHaveLength(1);
});

test("a file over 95 MiB warns once, is skipped, and the project still saves", async () => {
    const big = new Blob(["x"]);
    Object.defineProperty(big, "size", { value: MAX_UPLOAD_BYTES + 1 });
    h.projects = [withFile("a", "video:1")];
    h.blobs.set("video:1", big);
    await engine.run({ remote: false });
    expect(paths("POST")).toEqual(["/files/exists"]);
    expect(paths("PUT")).toEqual(["/projects/a"]);
    expect(h.notices).toEqual([{ kind: "fileTooLarge", megabytes: 96 }]);
    expect(h.state.projects.a.filesIncomplete).toBeUndefined();
});

describe("409", () => {
    const conflict = (server: Record<string, unknown>) => (route: string) => (route === "PUT /projects/a" ? json({ error: "revision_conflict", message: "changed", server }, 409) : undefined);

    beforeEach(() => {
        h.state.projects.a = { revision: 3, localUpdatedAt: T1 };
        h.projects = [project("a", { title: "Mine", updatedAt: T2 })];
    });

    test("keeps the local version as a copy and takes the server version", async () => {
        h.routes.push(conflict(meta("a", 5)), (route) => (route === "GET /projects/a" ? json({ ...meta("a", 5, { title: "Theirs" }), project: project("a", { title: "Theirs" }) }) : undefined));
        await engine.run({ remote: false });
        const original = h.projects.find((item) => item.id === "a");
        const copy = h.projects.find((item) => item.id === "new-1");
        expect(original?.title).toBe("Theirs");
        expect(copy?.title).toBe("Mine (local copy)");
        expect(copy?.updatedAt).toBe(NOW);
        expect(h.state.projects.a.revision).toBe(5);
        expect(h.notices).toEqual([{ kind: "conflict", title: "Mine", copyTitle: "Mine (local copy)" }]);
    });

    test("uploads the copy on the next cycle as a new project", async () => {
        h.routes.push(conflict(meta("a", 5)), (route) => (route === "GET /projects/a" ? json({ ...meta("a", 5), project: project("a") }) : undefined));
        await engine.run({ remote: false });
        h.routes.length = 0;
        await engine.run({ remote: false });
        expect(paths("PUT")).toContain("/projects/new-1");
        expect(h.calls.find((call) => call.path === "/projects/new-1")?.body?.base_revision).toBeUndefined();
    });

    test("a server tombstone keeps the copy and removes the original", async () => {
        h.routes.push(conflict(meta("a", 5, { deleted_at: T2 })));
        await engine.run({ remote: false });
        expect(h.projects.map((item) => item.title)).toEqual(["Mine (local copy)"]);
        expect(h.state.projects.a).toMatchObject({ revision: 5, deleted: true });
        expect(h.notices[0].kind).toBe("conflictDeleted");
    });

    test("no copy is made when the server version cannot be fetched", async () => {
        h.routes.push(conflict(meta("a", 5)), (route) => (route === "GET /projects/a" ? Promise.reject(new TypeError("Failed to fetch")) : undefined));
        await expect(engine.run({ remote: false })).rejects.toMatchObject({ isNetworkError: true });
        expect(h.projects.map((item) => item.id)).toEqual(["a"]);
    });
});

test("a 404 on PUT moves the project to a new id", async () => {
    h.projects = [project("a")];
    h.routes.push((route) => (route === "PUT /projects/a" ? json({ error: "project_not_found", message: "no" }, 404) : undefined));
    await engine.run({ remote: false });
    expect(h.projects.map((item) => item.id)).toEqual(["new-1"]);
});

describe("pull", () => {
    test("startup lists everything, then uses since from the largest updated_at", async () => {
        h.routes.push((route) => (route === "GET /projects" ? json({ projects: [meta("a", 1, { updated_at: "2026-11-02T08:00:02.500000+00:00" }), meta("b", 1, { updated_at: "2026-11-02T08:00:03+00:00" })], usage: emptyList.usage }) : undefined));
        h.routes.push((route) => (route.startsWith("GET /projects/") ? json({ ...meta(route.slice(-1), 1), project: project(route.slice(-1)) }) : undefined));
        await engine.run({ remote: true });
        expect(h.state.since).toBe("2026-11-02T08:00:03+00:00");
        h.calls.length = 0;
        await engine.run({ remote: true });
        expect(paths("GET")).toEqual(["/projects?since=2026-11-02T08%3A00%3A03%2B00%3A00"]);
    });

    test("restarting the app lists everything again even with a saved cursor", async () => {
        h.state.since = "2026-11-02T08:00:03+00:00";
        await engine.run({ remote: true });
        expect(paths("GET")).toEqual(["/projects"]);
    });

    test("the cursor does not advance when a cycle fails", async () => {
        h.routes.push((route) => (route === "GET /projects" ? json({ projects: [meta("b", 1, { updated_at: "2026-11-02T08:00:03+00:00" })], usage: emptyList.usage }) : undefined));
        h.routes.push((route) => (route === "GET /projects/b" ? json({ error: "internal_error", message: "boom" }, 500) : undefined));
        await expect(engine.run({ remote: true })).rejects.toBeDefined();
        expect(h.state.since).toBeNull();
    });

    test("a higher server revision overwrites a clean project but keeps this device's view", async () => {
        h.state.projects.a = { revision: 3, localUpdatedAt: T1 };
        h.projects = [project("a", { viewport: { x: 7, y: 7, k: 3 } })];
        h.routes.push((route) => (route === "GET /projects" ? json({ projects: [meta("a", 4)], usage: emptyList.usage }) : undefined));
        h.routes.push((route) => (route === "GET /projects/a" ? json({ ...meta("a", 4, { title: "Remote" }), project: project("a", { title: "Remote", updatedAt: T2, viewport: { x: 0, y: 0, k: 1 } }) }) : undefined));
        await engine.run({ remote: true });
        expect(h.projects[0]).toMatchObject({ title: "Remote", updatedAt: T2, viewport: { x: 7, y: 7, k: 3 } });
        expect(h.state.projects.a).toMatchObject({ revision: 4, localUpdatedAt: T2 });
    });

    test("an edit made during the download is not overwritten", async () => {
        h.state.projects.a = { revision: 3, localUpdatedAt: T1 };
        h.projects = [project("a")];
        h.routes.push((route) => (route === "GET /projects" ? json({ projects: [meta("a", 4)], usage: emptyList.usage }) : undefined));
        h.routes.push((route) => {
            if (route !== "GET /projects/a") return undefined;
            h.projects = [project("a", { title: "Edited meanwhile", updatedAt: T2 })];
            return json({ ...meta("a", 4), project: project("a", { title: "Remote" }) });
        });
        await engine.run({ remote: true });
        expect(h.projects[0].title).toBe("Edited meanwhile");
        expect(h.state.projects.a.revision).toBe(3);
    });

    test("a timestamp from a device with a fast clock is clamped so later edits still count", async () => {
        h.routes.push((route) => (route === "GET /projects" ? json({ projects: [meta("b", 1)], usage: emptyList.usage }) : undefined));
        h.routes.push((route) => (route === "GET /projects/b" ? json({ ...meta("b", 1), project: project("b", { updatedAt: "2030-01-01T00:00:00.000Z" }) }) : undefined));
        await engine.run({ remote: true });
        expect(h.projects[0].updatedAt).toBe(NOW);
    });

    test("a pulled project opened with no edits is not pushed back", async () => {
        h.routes.push((route) => (route === "GET /projects" ? json({ projects: [meta("b", 2)], usage: emptyList.usage }) : undefined));
        h.routes.push((route) => (route === "GET /projects/b" ? json({ ...meta("b", 2), project: project("b") }) : undefined));
        await engine.run({ remote: true });
        h.projects = [{ ...h.projects[0], updatedAt: NOW }];
        h.calls.length = 0;
        await engine.run({ remote: false });
        expect(h.calls).toEqual([]);
    });
});

describe("tombstones", () => {
    test("a server tombstone removes a clean local project", async () => {
        h.state.projects.a = { revision: 3, localUpdatedAt: T1 };
        h.projects = [project("a")];
        h.routes.push((route) => (route === "GET /projects" ? json({ projects: [meta("a", 4, { deleted_at: T2 })], usage: emptyList.usage }) : undefined));
        await engine.run({ remote: true });
        expect(h.projects).toEqual([]);
        expect(h.state.projects.a).toMatchObject({ revision: 4, deleted: true });
    });

    test("a local delete reaches the server once", async () => {
        h.state.projects.a = { revision: 3, localUpdatedAt: T1 };
        h.tombstones = ["a"];
        h.routes.push((route) => (route === "DELETE /projects/a" ? json(meta("a", 4, { deleted_at: T2 })) : undefined));
        await engine.run({ remote: false });
        await engine.run({ remote: false });
        expect(paths("DELETE")).toEqual(["/projects/a"]);
        expect(h.state.projects.a).toMatchObject({ revision: 4, deleted: true });
    });

    test("a delete the server does not know about counts as done", async () => {
        h.state.projects.a = { revision: 3, localUpdatedAt: T1 };
        h.tombstones = ["a"];
        h.routes.push((route) => (route === "DELETE /projects/a" ? json({ error: "project_not_found", message: "no" }, 404) : undefined));
        await engine.run({ remote: false });
        await engine.run({ remote: false });
        expect(paths("DELETE")).toHaveLength(1);
    });
});

test("a remote cycle records lastSyncedAt", async () => {
    await engine.run({ remote: true });
    expect(h.state.lastSyncedAt).toBe(NOW);
});
