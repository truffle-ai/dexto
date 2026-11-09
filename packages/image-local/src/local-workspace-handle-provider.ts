import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';
import { WorkspaceError } from '@dexto/core/workspace';
import type {
    OpenWorkspaceInput,
    WorkspaceCapability,
    WorkspaceContext,
    WorkspaceHandle,
    WorkspaceHandleProvider,
    WorkspaceProcesses,
} from '@dexto/core/workspace';
import { runCommand } from './run-command.js';

export class LocalWorkspaceHandleProvider implements WorkspaceHandleProvider {
    async open(input: {
        context: WorkspaceContext;
        input?: OpenWorkspaceInput;
    }): Promise<WorkspaceHandle> {
        const root = path.resolve(input.context.path);
        const files = new LocalWorkspaceFiles(root);

        const capabilities = resolveCapabilities(input.input);
        const handle: WorkspaceHandle = {
            context: {
                ...input.context,
                path: root,
            },
            capabilities,
            files,
        };

        if (capabilities.includes('processes')) {
            handle.processes = new LocalWorkspaceProcesses(root);
        }

        return handle;
    }
}

class LocalWorkspaceFiles {
    private realRoot: string | undefined;

    constructor(private root: string) {}

    readText = async (filePath: string): Promise<string> => {
        try {
            return await readFile(await this.resolveInsideRoot(filePath), 'utf-8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw WorkspaceError.fileNotFound(filePath);
            }
            throw error;
        }
    };

    /** Size in bytes, from the same contained real path `readText` would read. */
    readFileSize = async (filePath: string): Promise<number> => {
        try {
            return (await stat(await this.resolveInsideRoot(filePath))).size;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw WorkspaceError.fileNotFound(filePath);
            }
            throw error;
        }
    };

    readFile = async (filePath: string): Promise<string> => {
        return this.readText(filePath);
    };

    glob = async (pattern: string): Promise<string[]> => {
        this.assertRelativePattern(pattern);
        const files = await glob(pattern, {
            cwd: await this.getRealRoot(),
            absolute: false,
            nodir: true,
            follow: false,
            posix: true,
        });
        return files.sort();
    };

    writeFile = async (filePath: string, content: string): Promise<void> => {
        const resolvedPath = await this.resolveInsideRoot(filePath);
        await mkdir(path.dirname(resolvedPath), { recursive: true });
        try {
            await writeFile(resolvedPath, content, 'utf-8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw WorkspaceError.fileNotFound(filePath);
            }
            throw error;
        }
    };

    listFiles = async (directoryPath = '.'): Promise<string[]> => {
        const resolvedPath = await this.resolveInsideRoot(directoryPath);
        const relativePath = path.relative(await this.getRealRoot(), resolvedPath);
        const pattern = relativePath ? `${relativePath.split(path.sep).join('/')}/**/*` : '**/*';
        return this.glob(pattern);
    };

    /** The workspace root's real path, resolved once. The root itself may sit behind a symlink. */
    private async getRealRoot(): Promise<string> {
        this.realRoot ??= await realpath(this.root);
        return this.realRoot;
    }

    /**
     * Resolve a path to its real location and require it to be inside the real workspace root,
     * so a symlink in the workspace cannot lead out of it.
     */
    private async resolveInsideRoot(filePath: string): Promise<string> {
        const resolvedPath = path.isAbsolute(filePath)
            ? path.resolve(filePath)
            : path.resolve(this.root, filePath);
        const realRoot = await this.getRealRoot();
        const realPath = await realpathOfPossiblyMissing(resolvedPath, filePath);
        const relativePath = path.relative(realRoot, realPath);
        if (
            relativePath === '' ||
            (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
        ) {
            return realPath;
        }
        throw WorkspaceError.pathOutsideWorkspace(filePath);
    }

    private assertRelativePattern(pattern: string): void {
        if (path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..')) {
            throw WorkspaceError.pathOutsideWorkspace(pattern);
        }
    }
}

class LocalWorkspaceProcesses {
    constructor(private root: string) {}

    exec = async (input: {
        command: string;
        cwd?: string;
        timeout?: number;
        signal?: AbortSignal;
    }): ReturnType<WorkspaceProcesses['exec']> => {
        const cwd = input.cwd === undefined ? this.root : resolveInsideRoot(this.root, input.cwd);
        return runCommand(input.command, {
            cwd,
            ...(input.timeout === undefined ? {} : { timeout: input.timeout }),
            signal: input.signal,
        });
    };
}

function resolveCapabilities(input: OpenWorkspaceInput | undefined): WorkspaceCapability[] {
    const capabilities: WorkspaceCapability[] = ['files'];
    if (input?.intent === 'process' || input?.capabilities?.includes('processes')) {
        capabilities.push('processes');
    }
    return capabilities;
}

function resolveInsideRoot(root: string, filePath: string): string {
    const resolvedPath = path.isAbsolute(filePath)
        ? path.resolve(filePath)
        : path.resolve(root, filePath);
    const relativePath = path.relative(root, resolvedPath);
    if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
        return resolvedPath;
    }
    throw WorkspaceError.pathOutsideWorkspace(filePath);
}

/**
 * Real path of `target`; a missing tail is joined onto the real path of its nearest existing
 * ancestor. A dangling symlink is refused, because writing through it would create its target.
 */
async function realpathOfPossiblyMissing(target: string, requestedPath: string): Promise<string> {
    try {
        return await realpath(target);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') {
            throw error;
        }
    }
    const stats = await lstat(target).catch(() => undefined);
    if (stats?.isSymbolicLink()) {
        throw WorkspaceError.pathOutsideWorkspace(requestedPath);
    }
    const parent = path.dirname(target);
    if (parent === target) {
        return target;
    }
    return path.join(await realpathOfPossiblyMissing(parent, requestedPath), path.basename(target));
}
