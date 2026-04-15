import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Expand a leading home-directory shorthand (`~`) into an absolute path.
 * Leaves other path shapes untouched, including `~user/...`.
 */
export function expandHomeShorthand(inputPath: string): string {
    if (!/^~(?=$|[\\/])/.test(inputPath)) {
        return inputPath;
    }

    if (inputPath === '~') {
        return os.homedir();
    }

    return path.join(os.homedir(), inputPath.slice(2));
}

/**
 * Resolve a user-supplied path against a working directory after expanding
 * supported home-directory shorthand.
 */
export function resolveUserPath(workingDirectory: string, inputPath: string): string {
    const resolvedWorkingDirectory = path.resolve(expandHomeShorthand(workingDirectory));
    const expandedPath = expandHomeShorthand(inputPath);
    return path.isAbsolute(expandedPath)
        ? path.resolve(expandedPath)
        : path.resolve(resolvedWorkingDirectory, expandedPath);
}
