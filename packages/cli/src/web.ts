/**
 * Resolves the webRoot path for serving WebUI static files.
 *
 * In production builds, the WebUI dist is embedded at packages/cli/dist/webui.
 * This function returns the absolute path if found, otherwise undefined.
 */
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Discovers the webui path for embedded Vite build.
 * @returns Absolute path to webui dist folder, or undefined if not found
 */
export function resolveWebRoot(): string | undefined {
    const candidates: string[] = [];

    // 1) Node/Bun-from-source: webui next to the built JS in packages/cli/dist/webui
    try {
        const scriptDir = path.dirname(fileURLToPath(import.meta.url));
        candidates.push(path.resolve(scriptDir, 'webui'));
    } catch {
        // ignore
    }

    // 2) Explicit package root override (used by npm wrapper / exotic setups)
    if (process.env.DEXTO_PACKAGE_ROOT) {
        candidates.push(path.resolve(process.env.DEXTO_PACKAGE_ROOT, 'dist', 'webui'));
    }

    // 3) Compiled binary: assume <pkgRoot>/bin/dexto(.exe) and assets at <pkgRoot>/dist/webui
    try {
        const execDir = path.dirname(process.execPath);
        candidates.push(path.resolve(execDir, '..', 'dist', 'webui'));
    } catch {
        // ignore
    }

    for (const webuiPath of candidates) {
        if (!existsSync(webuiPath)) continue;
        const indexPath = path.join(webuiPath, 'index.html');
        if (!existsSync(indexPath)) continue;
        return webuiPath;
    }

    return undefined;
}
