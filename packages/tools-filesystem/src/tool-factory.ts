import type { ToolFactory } from '@dexto/agent-config';
import type { ToolExecutionContext } from '@dexto/core';
import { ToolError } from '@dexto/core';
import { FileSystemService } from './filesystem-service.js';
import type { FileSystemConfig } from './types.js';
import { createReadFileTool } from './read-file-tool.js';
import { createReadMediaFileTool } from './read-media-file-tool.js';
import { createWriteFileTool } from './write-file-tool.js';
import { createEditFileTool } from './edit-file-tool.js';
import { createGlobFilesTool } from './glob-files-tool.js';
import { createGrepContentTool } from './grep-content-tool.js';
import {
    FILESYSTEM_TOOL_NAMES,
    FileSystemToolsConfigSchema,
    type FileSystemToolsConfig,
} from './tool-factory-config.js';
import type { Tool } from '@dexto/core';

type FileSystemToolName = (typeof FILESYSTEM_TOOL_NAMES)[number];

export const fileSystemToolsFactory: ToolFactory<FileSystemToolsConfig> = {
    configSchema: FileSystemToolsConfigSchema,
    metadata: {
        displayName: 'Filesystem Tools',
        description: 'File system operations (read text/media, write, edit, glob, grep)',
        category: 'filesystem',
    },
    create: (config) => {
        const fileSystemConfig = {
            allowedPaths: config.allowedPaths,
            blockedPaths: config.blockedPaths,
            blockedExtensions: config.blockedExtensions,
            maxFileSize: config.maxFileSize,
            workingDirectory: config.workingDirectory ?? process.cwd(),
            enableBackups: config.enableBackups,
            backupPath: config.backupPath,
            backupRetentionDays: config.backupRetentionDays,
        };

        const resolveWorkingDirectory = (context: ToolExecutionContext): string =>
            context.workspace?.path ?? fileSystemConfig.workingDirectory ?? process.cwd();

        const createScopedFileSystemService = (
            context: ToolExecutionContext,
            baseConfig: FileSystemConfig
        ): FileSystemService => {
            const approvalManager = context.services?.approval;
            if (!approvalManager) {
                throw ToolError.configInvalid(
                    'filesystem-tools requires ToolExecutionContext.services.approval'
                );
            }

            const service = new FileSystemService(
                {
                    ...baseConfig,
                    workingDirectory: resolveWorkingDirectory(context),
                },
                context.logger
            );
            service.setDirectoryApprovalChecker((filePath: string) =>
                approvalManager.isDirectoryApproved(filePath, context.sessionId)
            );
            return service;
        };

        const resolveInjectedServiceConfig = (
            context: ToolExecutionContext
        ): FileSystemConfig | null => {
            const candidate = (context.services as unknown as { filesystemService?: unknown })
                ?.filesystemService;
            if (!candidate) return null;
            if (candidate instanceof FileSystemService) return candidate.getConfig();

            const getConfig = (candidate as { getConfig?: unknown }).getConfig;
            if (typeof getConfig === 'function') {
                return getConfig.call(candidate) as FileSystemConfig;
            }

            return null;
        };

        const getFileSystemService = async (
            context: ToolExecutionContext
        ): Promise<FileSystemService> => {
            const scopedFileSystemService = createScopedFileSystemService(
                context,
                resolveInjectedServiceConfig(context) ?? fileSystemConfig
            );
            await scopedFileSystemService.initialize();
            return scopedFileSystemService;
        };

        const toolCreators: Record<FileSystemToolName, () => Tool> = {
            read_file: () => createReadFileTool(getFileSystemService),
            read_media_file: () => createReadMediaFileTool(getFileSystemService),
            write_file: () => createWriteFileTool(getFileSystemService),
            edit_file: () => createEditFileTool(getFileSystemService),
            glob_files: () => createGlobFilesTool(getFileSystemService),
            grep_content: () => createGrepContentTool(getFileSystemService),
        };

        const toolsToCreate = config.enabledTools ?? FILESYSTEM_TOOL_NAMES;
        return toolsToCreate.map((toolName) => toolCreators[toolName]());
    },
};
