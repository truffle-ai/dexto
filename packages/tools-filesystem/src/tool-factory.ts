import type { ToolFactory } from '@dexto/agent-config';
import type { ToolExecutionContext } from '@dexto/core';
import { FileSystemService } from './filesystem-service.js';
import { createReadFileTool } from './read-file-tool.js';
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
        displayName: 'FileSystem Tools',
        description: 'File system operations (read, write, edit, glob, grep)',
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

        let fileSystemService: FileSystemService | undefined;

        const getFileSystemService = async (
            context?: ToolExecutionContext
        ): Promise<FileSystemService> => {
            if (fileSystemService) {
                const approvalManager = context?.services?.approval;
                if (approvalManager) {
                    fileSystemService.setDirectoryApprovalChecker((filePath: string) =>
                        approvalManager.isDirectoryApproved(filePath)
                    );
                }
                return fileSystemService;
            }

            const logger = context?.logger;
            if (!logger) {
                throw new Error(
                    'filesystem-tools requires ToolExecutionContext.logger (ToolManager should provide this)'
                );
            }

            fileSystemService = new FileSystemService(fileSystemConfig, logger);

            const approvalManager = context?.services?.approval;
            if (approvalManager) {
                fileSystemService.setDirectoryApprovalChecker((filePath: string) =>
                    approvalManager.isDirectoryApproved(filePath)
                );
            }

            fileSystemService.initialize().catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`Failed to initialize FileSystemService: ${message}`);
            });

            return fileSystemService;
        };

        const toolCreators: Record<FileSystemToolName, () => Tool> = {
            read_file: () => createReadFileTool(getFileSystemService),
            write_file: () => createWriteFileTool(getFileSystemService),
            edit_file: () => createEditFileTool(getFileSystemService),
            glob_files: () => createGlobFilesTool(getFileSystemService),
            grep_content: () => createGrepContentTool(getFileSystemService),
        };

        const toolsToCreate = config.enabledTools ?? FILESYSTEM_TOOL_NAMES;
        return toolsToCreate.map((toolName) => toolCreators[toolName]());
    },
};
