import { expect, test } from "bun:test";

import { CloudSyncError, createCloudClient } from "../src/services/genra/cloud-sync-client";

type Call = { url: string; init: RequestInit };

function mockClient(respond: (call: Call) => Response | Promise<Response>) {
    const calls: Call[] = [];
    const client = createCloudClient({
        baseUrl: "https://api.test/api/v1/canvas",
        getToken: () => "jwt",
        fetchImpl: (async (url: string, init: RequestInit) => {
            const call = { url, init };
            calls.push(call);
            return respond(call);
        }) as typeof fetch,
    });
    return { client, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("sends the bearer token on every request", async () => {
    const { client, calls } = mockClient(() => json({ projects: [], usage: { bytes_used: 0, bytes_limit: 1 } }));
    await client.listProjects();
    expect(new Headers(calls[0].init.headers).get("Authorization")).toBe("Bearer jwt");
});

test("encodes since, whose + would otherwise read as a space", async () => {
    const { client, calls } = mockClient(() => json({ projects: [], usage: { bytes_used: 0, bytes_limit: 1 } }));
    await client.listProjects("2026-11-02T08:00:01.5+00:00");
    expect(calls[0].url).toBe("https://api.test/api/v1/canvas/projects?since=2026-11-02T08%3A00%3A01.5%2B00%3A00");
});

test("a full list sends no since", async () => {
    const { client, calls } = mockClient(() => json({ projects: [], usage: { bytes_used: 0, bytes_limit: 1 } }));
    await client.listProjects(null);
    expect(calls[0].url).toBe("https://api.test/api/v1/canvas/projects");
});

test("PUT drops object URLs from the project body", async () => {
    const { client, calls } = mockClient(() => json({ id: "a", revision: 1 }));
    await client.putProject("a", { title: "t", base_revision: 2, client_updated_at: "now", project: { nodes: [{ metadata: { content: "blob:http://x/1" } }] } });
    const body = JSON.parse(calls[0].init.body as string);
    expect(calls[0].init.method).toBe("PUT");
    expect(body.base_revision).toBe(2);
    expect(body.project.nodes[0].metadata.content).toBe("blob:");
});

test("a 409 exposes the server metadata", async () => {
    const { client } = mockClient(() => json({ error: "revision_conflict", message: "changed", server: { id: "a", revision: 9 } }, 409));
    const error = await client.putProject("a", { title: "t", client_updated_at: "now", project: {} }).catch((reason) => reason);
    expect(error).toBeInstanceOf(CloudSyncError);
    expect(error.status).toBe(409);
    expect(error.code).toBe("revision_conflict");
    expect(error.body.server.revision).toBe(9);
});

test("a 413 keeps the error code that tells quota from file size", async () => {
    const { client } = mockClient(() => json({ error: "storage_quota_exceeded", message: "full", usage: { bytes_used: 2, bytes_limit: 1 } }, 413));
    const error = await client.uploadFile("image:a", new Blob(["x"])).catch((reason) => reason);
    expect(error.code).toBe("storage_quota_exceeded");
});

test("an error page with no JSON body still gives a usable error", async () => {
    const { client } = mockClient(() => new Response("<html>bad gateway</html>", { status: 502 }));
    const error = await client.getUsage().catch((reason) => reason);
    expect(error.status).toBe(502);
    expect(error.code).toBe("http_error");
});

test("a failed fetch is reported as a network error", async () => {
    const { client } = mockClient(() => Promise.reject(new TypeError("Failed to fetch")));
    const error = await client.getUsage().catch((reason) => reason);
    expect(error.isNetworkError).toBe(true);
});

test("exists checks are split into batches of 1000", async () => {
    const { client, calls } = mockClient(({ init }) => json({ present: JSON.parse(init.body as string).keys.slice(0, 1) }));
    const keys = Array.from({ length: 1500 }, (_, index) => `image:${index}`);
    const present = await client.existingFiles(keys);
    expect(calls.map(({ init }) => JSON.parse(init.body as string).keys.length)).toEqual([1000, 500]);
    expect([...present]).toEqual(["image:0", "image:1000"]);
});

test("uploads are multipart and leave the content type to the browser", async () => {
    const { client, calls } = mockClient(() => json({ storage_key: "image:a", bytes: 1, mime_type: "image/png" }));
    await client.uploadFile("image:a", new Blob(["x"], { type: "image/png" }));
    const form = calls[0].init.body as FormData;
    expect(form.get("storage_key")).toBe("image:a");
    expect(form.get("mime_type")).toBe("image/png");
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(new Headers(calls[0].init.headers).has("Content-Type")).toBe(false);
});

test("downloads encode the key and return the blob", async () => {
    const { client, calls } = mockClient(() => new Response("data", { headers: { "Content-Type": "image/png" } }));
    const blob = await client.downloadFile("image:a");
    expect(calls[0].url).toBe("https://api.test/api/v1/canvas/files/image%3Aa");
    expect(await blob?.text()).toBe("data");
});

test("a download 404 is null, other failures throw", async () => {
    const missing = mockClient(() => json({ error: "file_not_found", message: "no" }, 404));
    expect(await missing.client.downloadFile("image:a")).toBeNull();
    const broken = mockClient(() => json({ error: "internal_error", message: "boom" }, 500));
    expect(await broken.client.downloadFile("image:a").catch((reason) => reason)).toBeInstanceOf(CloudSyncError);
});
