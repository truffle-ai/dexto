import * as path from 'node:path';
import type { ToolFactory } from '@dexto/agent-config';
import type { IDextoLogger } from '@dexto/core';
import { FileSystemService } from './filesystem-service.js';
import { createReadFileTool } from './read-file-tool.js';
import { createWriteFileTool } from './write-file-tool.js';
import { createEditFileTool } from './edit-file-tool.js';
import { createGlobFilesTool } from './glob-files-tool.js';
import { createGrepContentTool } from './grep-content-tool.js';
import { FileSystemToolsConfigSchema, type FileSystemToolsConfig } from './tool-provider.js';
import type { DirectoryApprovalCallbacks, FileToolOptions } from './file-tool-types.js';
import type { InternalTool } from '@dexto/core';

const FILESYSTEM_TOOL_NAMES = [
    'read_file',
    'write_file',
    'edit_file',
    'glob_files',
    'grep_content',
] as const;
type FileSystemToolName = (typeof FILESYSTEM_TOOL_NAMES)[number];

// TODO: temporary glue code to be removed/verified (remove-by: 5.1)
// ToolFactory.create() currently has no access to the agent logger/services at factory time.
// For now, we construct FileSystemService with a noop logger and keep directory approvals
// in a local map. Once tool factories can receive runtime dependencies (or tool approval hooks
// accept ToolExecutionContext), remove this and use the agent-provided logger/approval manager.
function createNoopLogger(): IDextoLogger {
    const noop = () => undefined;
    return {
        debug: noop,
        silly: noop,
        info: noop,
        warn: noop,
        error: noop,
        trackException: noop,
        createChild: () => createNoopLogger(),
        setLevel: noop,
        getLevel: () => 'info',
        getLogFilePath: () => null,
        destroy: async () => undefined,
    };
}

function isPathWithinDirectory(dir: string, filePath: string): boolean {
    const relative = path.relative(dir, filePath);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
}

export const fileSystemToolsFactory: ToolFactory<FileSystemToolsConfig> = {
    configSchema: FileSystemToolsConfigSchema,
    metadata: {
        displayName: 'FileSystem Tools',
        description: 'File system operations (read, write, edit, glob, grep)',
        category: 'filesystem',
    },
    create: (config) => {
        // TODO: temporary glue code to be removed/verified (remove-by: 5.1)
        const approvedDirectories: Map<string, 'session' | 'once'> = new Map();

        const directoryApproval: DirectoryApprovalCallbacks = {
            isSessionApproved: (filePath: string) => {
                const normalized = path.resolve(filePath);
                for (const [approvedDir, type] of approvedDirectories) {
                    if (type !== 'session') continue;
                    if (isPathWithinDirectory(approvedDir, normalized)) {
                        return true;
                    }
                }
                return false;
            },
            addApproved: (directory: string, type: 'session' | 'once') => {
                const normalized = path.resolve(directory);
                const existing = approvedDirectories.get(normalized);
                if (existing === 'session') {
                    return;
                }
                approvedDirectories.set(normalized, type);
            },
        };

        const isDirectoryApproved = (filePath: string) => {
            const normalized = path.resolve(filePath);
            for (const [approvedDir] of approvedDirectories) {
                if (isPathWithinDirectory(approvedDir, normalized)) {
                    return true;
                }
            }
            return false;
        };

        const fileSystemService = new FileSystemService(
            {
                allowedPaths: config.allowedPaths,
                blockedPaths: config.blockedPaths,
                blockedExtensions: config.blockedExtensions,
                maxFileSize: config.maxFileSize,
                workingDirectory: config.workingDirectory ?? process.cwd(),
                enableBackups: config.enableBackups,
                backupPath: config.backupPath,
                backupRetentionDays: config.backupRetentionDays,
            },
            createNoopLogger()
        );

        fileSystemService.setDirectoryApprovalChecker(isDirectoryApproved);
        fileSystemService.initialize().catch(() => undefined);

        const fileToolOptions: FileToolOptions = {
            fileSystemService,
            directoryApproval,
        };

        const toolCreators: Record<FileSystemToolName, () => InternalTool> = {
            read_file: () => createReadFileTool(fileToolOptions),
            write_file: () => createWriteFileTool(fileToolOptions),
            edit_file: () => createEditFileTool(fileToolOptions),
            glob_files: () => createGlobFilesTool(fileToolOptions),
            grep_content: () => createGrepContentTool(fileToolOptions),
        };

        const toolsToCreate = config.enabledTools ?? FILESYSTEM_TOOL_NAMES;
        return toolsToCreate.map((toolName) => toolCreators[toolName]());
    },
};
