// Import a canvas package (.zip produced by exportCanvasProjects) into the local library.
// Shared by the canvas list page and the canvas page "more" menu.
import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import type { CanvasExportFile } from "@/types/canvas-export";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export async function importCanvasPackage(file: File, importProject: (project: Partial<CanvasProject>) => string) {
    const zip = await readZip(file);
    const projectFile = zip.get("projects.json");
    if (!projectFile) throw new Error("missing projects.json");
    const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
    await Promise.all(
        data.projects.flatMap((project) =>
            project.files.map(async (item) => {
                const blob = zip.get(item.path);
                if (!blob) return;
                const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
                await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
            }),
        ),
    );
    data.projects.forEach((item) => importProject(item.project));
    return data.projects.length;
}
