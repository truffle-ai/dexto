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
    // Path discovery logic for the built webui
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));

    // Look for embedded webui in CLI's dist folder
    const webuiPath = path.resolve(scriptDir, 'webui');

    if (!existsSync(webuiPath)) {
        return undefined;
    }

    // Verify index.html exists (Vite output)
    const indexPath = path.join(webuiPath, 'index.html');
    if (!existsSync(indexPath)) {
        return undefined;
    }

    return webuiPath;
}
