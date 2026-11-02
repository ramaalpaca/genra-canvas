import { describe, expect, test } from "bun:test";

import { nextSinceCursor, planCloudSync, projectContentSource, type PlanInput, type ServerProjectMeta } from "../src/services/genra/cloud-sync-planner";

const T1 = "2026-11-02T08:00:00.000Z";
const T2 = "2026-11-02T09:00:00.000Z";

function meta(id: string, revision: number, extra: Partial<ServerProjectMeta> = {}): ServerProjectMeta {
    return { id, title: id, revision, node_count: 0, data_bytes: 0, client_updated_at: T1, updated_at: "2026-11-02T08:00:01+00:00", created_at: T1, deleted_at: null, ...extra };
}

function plan(input: Partial<PlanInput>) {
    return planCloudSync({ localProjects: [], localTombstones: [], known: {}, serverProjects: [], serverListComplete: false, ...input });
}

describe("planCloudSync: local projects", () => {
    test("a project never uploaded is pushed with no base revision", () => {
        expect(plan({ localProjects: [{ id: "a", updatedAt: T1 }] }).push).toEqual([{ id: "a" }]);
    });

    test("local edits are pushed from the known revision", () => {
        const result = plan({ localProjects: [{ id: "a", updatedAt: T2 }], known: { a: { revision: 3, localUpdatedAt: T1 } } });
        expect(result.push).toEqual([{ id: "a", baseRevision: 3 }]);
    });

    test("an unchanged project does nothing", () => {
        const result = plan({ localProjects: [{ id: "a", updatedAt: T1 }], known: { a: { revision: 3, localUpdatedAt: T1 } }, serverProjects: [meta("a", 3)] });
        expect(result).toEqual({ push: [], pull: [], deleteRemote: [], deleteLocal: [], adopt: [] });
    });

    test("an older local copy, as in a stale second tab, is not treated as an edit", () => {
        const result = plan({ localProjects: [{ id: "a", updatedAt: T1 }], known: { a: { revision: 3, localUpdatedAt: T2 } } });
        expect(result.push).toEqual([]);
    });

    test("a newer server revision is pulled when local is clean", () => {
        const result = plan({ localProjects: [{ id: "a", updatedAt: T1 }], known: { a: { revision: 3, localUpdatedAt: T1 } }, serverProjects: [meta("a", 4)] });
        expect(result.pull).toEqual([{ id: "a", expectedUpdatedAt: T1 }]);
        expect(result.push).toEqual([]);
    });

    test("edits on both sides are pushed from the old base so the server answers 409", () => {
        const result = plan({ localProjects: [{ id: "a", updatedAt: T2 }], known: { a: { revision: 3, localUpdatedAt: T1 } }, serverProjects: [meta("a", 4)] });
        expect(result.push).toEqual([{ id: "a", baseRevision: 3 }]);
        expect(result.pull).toEqual([]);
    });

    test("lost sync state with matching content adopts the server revision", () => {
        const result = plan({ localProjects: [{ id: "a", updatedAt: T1 }], serverProjects: [meta("a", 7, { client_updated_at: "2026-11-02T08:00:00+00:00" })] });
        expect(result.adopt).toEqual([{ id: "a", revision: 7, localUpdatedAt: T1 }]);
        expect(result.push).toEqual([]);
    });

    test("lost sync state with different content goes through the conflict path", () => {
        expect(plan({ localProjects: [{ id: "a", updatedAt: T2 }], serverProjects: [meta("a", 7)] }).push).toEqual([{ id: "a" }]);
    });

    test("a full list that lacks a known project uploads it again", () => {
        const result = plan({ localProjects: [{ id: "a", updatedAt: T1 }], known: { a: { revision: 3, localUpdatedAt: T1 } }, serverListComplete: true });
        expect(result.push).toEqual([{ id: "a" }]);
    });

    test("an incremental list that lacks a known project means nothing changed", () => {
        const result = plan({ localProjects: [{ id: "a", updatedAt: T1 }], known: { a: { revision: 3, localUpdatedAt: T1 } } });
        expect(result.push).toEqual([]);
    });

    test("a project refused as too large waits until it changes", () => {
        const known = { a: { revision: 3, localUpdatedAt: T1, blockedUpdatedAt: T2 } };
        expect(plan({ localProjects: [{ id: "a", updatedAt: T2 }], known }).push).toEqual([]);
        expect(plan({ localProjects: [{ id: "a", updatedAt: "2026-11-02T10:00:00.000Z" }], known }).push).toEqual([{ id: "a", baseRevision: 3 }]);
    });

    test("projects another account synced from this browser are not uploaded", () => {
        expect(plan({ localProjects: [{ id: "a", updatedAt: T1 }], excludeIds: ["a"] }).push).toEqual([]);
    });
});

describe("planCloudSync: tombstones", () => {
    test("a server tombstone removes a clean local project", () => {
        const result = plan({ localProjects: [{ id: "a", updatedAt: T1 }], known: { a: { revision: 3, localUpdatedAt: T1 } }, serverProjects: [meta("a", 4, { deleted_at: T2 })] });
        expect(result.deleteLocal).toEqual([{ id: "a", revision: 4 }]);
    });

    test("a server tombstone over local edits is pushed so the conflict path keeps them", () => {
        const result = plan({ localProjects: [{ id: "a", updatedAt: T2 }], known: { a: { revision: 3, localUpdatedAt: T1 } }, serverProjects: [meta("a", 4, { deleted_at: T2 })] });
        expect(result.push).toEqual([{ id: "a", baseRevision: 3 }]);
        expect(result.deleteLocal).toEqual([]);
    });

    test("a local delete of a synced project is sent to the server", () => {
        expect(plan({ localTombstones: ["a"], known: { a: { revision: 3, localUpdatedAt: T1 } } }).deleteRemote).toEqual(["a"]);
    });

    test("a local delete of a project never uploaded sends nothing", () => {
        expect(plan({ localTombstones: ["a"] }).deleteRemote).toEqual([]);
    });

    test("a local delete the server already applied sends nothing", () => {
        const result = plan({ localTombstones: ["a"], known: { a: { revision: 4, localUpdatedAt: T1, deleted: true } }, serverProjects: [meta("a", 4, { deleted_at: T2 })] });
        expect(result.deleteRemote).toEqual([]);
        expect(result.pull).toEqual([]);
    });

    test("a locally deleted project is not pulled back", () => {
        const result = plan({ localTombstones: ["a"], known: { a: { revision: 3, localUpdatedAt: T1 } }, serverProjects: [meta("a", 4)] });
        expect(result.pull).toEqual([]);
        expect(result.deleteRemote).toEqual(["a"]);
    });

    test("a project restored on another device after both sides deleted it is pulled", () => {
        const result = plan({ localTombstones: ["a"], known: { a: { revision: 4, localUpdatedAt: T1, deleted: true } }, serverProjects: [meta("a", 5)] });
        expect(result.pull).toEqual([{ id: "a", expectedUpdatedAt: null }]);
        expect(result.deleteRemote).toEqual([]);
    });
});

describe("planCloudSync: server-only projects", () => {
    test("a project only on the server is pulled", () => {
        expect(plan({ serverProjects: [meta("b", 2)] }).pull).toEqual([{ id: "b", expectedUpdatedAt: null }]);
    });

    test("a tombstone this browser never saw is ignored", () => {
        const result = plan({ serverProjects: [meta("b", 2, { deleted_at: T2 })] });
        expect(result.pull).toEqual([]);
        expect(result.deleteLocal).toEqual([]);
    });
});

describe("nextSinceCursor", () => {
    test("takes the largest updated_at and keeps the cursor when there is nothing new", () => {
        const projects = [meta("a", 1, { updated_at: "2026-11-02T08:00:01.100000+00:00" }), meta("b", 1, { updated_at: "2026-11-02T08:00:01.900000+00:00" })];
        expect(nextSinceCursor(null, projects)).toBe("2026-11-02T08:00:01.900000+00:00");
        expect(nextSinceCursor("2026-11-03T00:00:00+00:00", [])).toBe("2026-11-03T00:00:00+00:00");
    });

    test("orders a whole-second timestamp before a fractional one in the same second", () => {
        expect(nextSinceCursor("2026-11-02T08:00:01+00:00", [meta("a", 1, { updated_at: "2026-11-02T08:00:01.500000+00:00" })])).toBe("2026-11-02T08:00:01.500000+00:00");
    });
});

describe("projectContentSource", () => {
    const project = { id: "a", title: "t", nodes: [{ metadata: { content: "blob:http://localhost/1", storageKey: "image:x" } }], updatedAt: T1, viewport: { x: 0, y: 0, k: 1 } };

    test("ignores updatedAt, viewport and per-load object URLs", () => {
        const reopened = { ...project, updatedAt: T2, viewport: { x: 9, y: 9, k: 2 }, nodes: [{ metadata: { content: "blob:http://localhost/2", storageKey: "image:x" } }] };
        expect(projectContentSource(reopened)).toBe(projectContentSource(project));
    });

    test("ignores key order", () => {
        const { title, id, ...rest } = project;
        expect(projectContentSource({ ...rest, title, id })).toBe(projectContentSource(project));
    });

    test("sees real edits", () => {
        expect(projectContentSource({ ...project, title: "renamed" })).not.toBe(projectContentSource(project));
    });
});
