import { exec as execCallback } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { glob } from 'glob';
import { WorkspaceError } from '@dexto/core/workspace';
import type {
    OpenWorkspaceInput,
    WorkspaceCapability,
    WorkspaceContext,
    WorkspaceHandle,
    WorkspaceHandleProvider,
} from '@dexto/core/workspace';

const exec = promisify(execCallback);

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
    constructor(private root: string) {}

    readText = async (filePath: string): Promise<string> => {
        try {
            return await readFile(this.resolveInsideRoot(filePath), 'utf-8');
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
            cwd: this.root,
            absolute: false,
            nodir: true,
            follow: false,
            posix: true,
        });
        return files.sort();
    };

    writeFile = async (filePath: string, content: string): Promise<void> => {
        const resolvedPath = this.resolveInsideRoot(filePath);
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
        const resolvedPath = this.resolveInsideRoot(directoryPath);
        const relativePath = path.relative(this.root, resolvedPath);
        const pattern = relativePath ? `${relativePath.split(path.sep).join('/')}/**/*` : '**/*';
        return this.glob(pattern);
    };

    private resolveInsideRoot(filePath: string): string {
        const resolvedPath = path.isAbsolute(filePath)
            ? path.resolve(filePath)
            : path.resolve(this.root, filePath);
        const relativePath = path.relative(this.root, resolvedPath);
        if (
            relativePath === '' ||
            (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
        ) {
            return resolvedPath;
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
    }): Promise<{ stdout: string; stderr: string }> => {
        const cwd = input.cwd === undefined ? this.root : resolveInsideRoot(this.root, input.cwd);
        const result = await exec(input.command, { cwd });
        return {
            stdout: result.stdout,
            stderr: result.stderr,
        };
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
