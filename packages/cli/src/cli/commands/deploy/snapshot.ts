import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { minimatch } from 'minimatch';
import { create as createTar } from 'tar';
import { normalizeWorkspaceRelativePath } from './config.js';

export interface WorkspaceSnapshotResult {
    archivePath: string;
    sizeBytes: number;
    cleanup: () => Promise<void>;
}

function normalizeArchivePath(value: string): string {
    return value
        .replace(/\\/g, '/')
        .replace(/^\.\/+/, '')
        .replace(/\/+$/, '');
}

function normalizeExcludePattern(value: string): string {
    return value
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\.\/+/, '')
        .replace(/\/+$/, '');
}

export function shouldExcludeRelativePath(
    relativePath: string,
    excludePatterns: string[]
): boolean {
    const normalizedRelativePath = normalizeWorkspaceRelativePath(relativePath);
    const basename = path.posix.basename(normalizedRelativePath);

    return excludePatterns.some((pattern) => {
        const normalizedPattern = normalizeExcludePattern(pattern);
        if (normalizedPattern.length === 0) {
            return false;
        }
        if (
            normalizedRelativePath === normalizedPattern ||
            normalizedRelativePath.startsWith(`${normalizedPattern}/`)
        ) {
            return true;
        }
        return (
            minimatch(normalizedRelativePath, normalizedPattern, { dot: true }) ||
            minimatch(basename, normalizedPattern, { dot: true })
        );
    });
}

export async function createWorkspaceSnapshot(input: {
    workspaceRoot: string;
    entryAgent: string;
    exclude: string[];
}): Promise<WorkspaceSnapshotResult> {
    const workspaceRoot = path.resolve(input.workspaceRoot);
    const entryAgent = normalizeWorkspaceRelativePath(input.entryAgent);

    if (shouldExcludeRelativePath(entryAgent, input.exclude)) {
        throw new Error(
            `Deploy config excludes the selected entry agent: ${entryAgent}. Remove it from exclude before deploying.`
        );
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-deploy-'));
    const archivePath = path.join(tempDir, 'workspace.tar.gz');
    const topLevelEntries = await fs.readdir(workspaceRoot);

    try {
        await createTar(
            {
                cwd: workspaceRoot,
                file: archivePath,
                gzip: true,
                portable: true,
                noMtime: true,
                prefix: 'workspace',
                filter: (entryPath) => {
                    const relativePath = normalizeArchivePath(entryPath);
                    if (relativePath.length === 0) {
                        return false;
                    }
                    return !shouldExcludeRelativePath(relativePath, input.exclude);
                },
            },
            topLevelEntries
        );

        const stats = await fs.stat(archivePath);
        return {
            archivePath,
            sizeBytes: stats.size,
            cleanup: async () => {
                await fs.rm(tempDir, { recursive: true, force: true });
            },
        };
    } catch (error) {
        await fs.rm(tempDir, { recursive: true, force: true });
        throw error;
    }
}
