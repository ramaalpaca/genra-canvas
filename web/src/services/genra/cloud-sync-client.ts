// REST transport for the canvas cloud API (video_mvp backend/api/rest/CANVAS_API.md).
// Everything goes through fetch with a bearer token: the backend reads no cookies, so files cannot be plain <img src> URLs.
import { stripObjectUrls, type ServerProjectMeta } from "./cloud-sync-planner";

export type CloudUsage = { bytes_used: number; bytes_limit: number };
export type ServerProjectDetail = ServerProjectMeta & { project: unknown };

const EXISTS_BATCH_SIZE = 1000;

export class CloudSyncError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly body: Record<string, unknown> = {},
    ) {
        super(message);
        this.name = "CloudSyncError";
    }

    /** No response at all: offline, DNS, CORS, or Cloudflare dropping the request. */
    get isNetworkError() {
        return this.status === 0;
    }
}

export type CloudClientOptions = {
    baseUrl: string;
    getToken: () => string;
    fetchImpl?: typeof fetch;
};

export type CloudClient = ReturnType<typeof createCloudClient>;

export function createCloudClient({ baseUrl, getToken, fetchImpl }: CloudClientOptions) {
    const send = async (path: string, init: RequestInit = {}) => {
        let response: Response;
        try {
            response = await (fetchImpl ?? fetch)(`${baseUrl}${path}`, { ...init, headers: { Authorization: `Bearer ${getToken()}`, ...init.headers } });
        } catch (error) {
            throw new CloudSyncError(0, "network_error", error instanceof Error ? error.message : "Network error");
        }
        if (response.ok) return response;
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        throw new CloudSyncError(response.status, typeof body.error === "string" ? body.error : "http_error", typeof body.message === "string" ? body.message : `HTTP ${response.status}`, body);
    };
    const sendJson = async <T>(path: string, method: string, body: unknown, replacer?: (key: string, value: unknown) => unknown) => {
        const response = await send(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body, replacer) });
        return (await response.json()) as T;
    };
    const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`;

    return {
        async listProjects(since?: string | null) {
            const query = since ? `?since=${encodeURIComponent(since)}` : "";
            return (await (await send(`/projects${query}`)).json()) as { projects: ServerProjectMeta[]; usage: CloudUsage };
        },
        async getProject(id: string) {
            return (await (await send(projectPath(id))).json()) as ServerProjectDetail;
        },
        putProject(id: string, payload: { title: string; base_revision?: number; client_updated_at: string; project: unknown }) {
            return sendJson<ServerProjectMeta>(projectPath(id), "PUT", payload, stripObjectUrls);
        },
        async deleteProject(id: string) {
            return (await (await send(projectPath(id), { method: "DELETE" })).json()) as ServerProjectMeta;
        },
        async existingFiles(keys: string[]) {
            const present = new Set<string>();
            for (let start = 0; start < keys.length; start += EXISTS_BATCH_SIZE) {
                const result = await sendJson<{ present: string[] }>("/files/exists", "POST", { keys: keys.slice(start, start + EXISTS_BATCH_SIZE) });
                result.present.forEach((key) => present.add(key));
            }
            return present;
        },
        async uploadFile(storageKey: string, blob: Blob) {
            const form = new FormData();
            form.append("storage_key", storageKey);
            if (blob.type) form.append("mime_type", blob.type);
            form.append("file", blob, "file");
            await send("/files", { method: "POST", body: form });
        },
        /** Null when the server has no such file. */
        async downloadFile(storageKey: string) {
            try {
                return await (await send(`/files/${encodeURIComponent(storageKey)}`)).blob();
            } catch (error) {
                if (error instanceof CloudSyncError && error.status === 404) return null;
                throw error;
            }
        },
        async getUsage() {
            return (await (await send("/usage")).json()) as CloudUsage;
        },
    };
}
