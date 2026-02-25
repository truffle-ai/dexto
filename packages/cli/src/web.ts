/**
 * Resolves the webRoot path for serving WebUI static files.
 *
 * In production builds, the WebUI dist is embedded at packages/cli/dist/webui.
 * This function returns the absolute path if found, otherwise undefined.
 */
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function isValidWebRoot(webRootPath: string): boolean {
    if (!existsSync(webRootPath)) {
        return false;
    }

    // Verify index.html exists (Vite output)
    const indexPath = path.join(webRootPath, 'index.html');
    return existsSync(indexPath);
}

/**
 * Discovers the webui path for embedded Vite build.
 * @returns Absolute path to webui dist folder, or undefined if not found
 */
export function resolveWebRoot(): string | undefined {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const roots = Array.from(
        new Set([process.env.DEXTO_PACKAGE_ROOT, path.dirname(process.execPath), scriptDir])
    ).filter((value): value is string => Boolean(value));

    for (const root of roots) {
        const candidates = [path.resolve(root, 'webui'), path.resolve(root, 'dist', 'webui')];
        for (const webRootPath of candidates) {
            if (isValidWebRoot(webRootPath)) {
                return webRootPath;
            }
        }
    }

    return undefined;
}
