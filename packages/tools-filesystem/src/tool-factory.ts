import type { ToolFactory } from '@dexto/agent-config';
import type { ToolExecutionContext } from '@dexto/core';
import { ToolError } from '@dexto/core';
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
        displayName: 'Filesystem Tools',
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

        const resolveWorkingDirectory = (context: ToolExecutionContext): string =>
            context.workspace?.path ?? fileSystemConfig.workingDirectory ?? process.cwd();

        const applyWorkspace = (context: ToolExecutionContext, service: FileSystemService) => {
            const workingDirectory = resolveWorkingDirectory(context);
            service.setWorkingDirectory(workingDirectory);
        };

        const resolveInjectedService = (
            context: ToolExecutionContext
        ): FileSystemService | null => {
            const candidate = (context.services as unknown as { filesystemService?: unknown })
                ?.filesystemService as FileSystemService | undefined;
            if (!candidate) return null;
            if (candidate instanceof FileSystemService) return candidate;
            const hasMethods =
                typeof (candidate as FileSystemService).readFile === 'function' &&
                typeof (candidate as FileSystemService).writeFile === 'function' &&
                typeof (candidate as FileSystemService).setWorkingDirectory === 'function' &&
                typeof (candidate as FileSystemService).setDirectoryApprovalChecker === 'function';
            return hasMethods ? (candidate as FileSystemService) : null;
        };

        const getFileSystemService = async (
            context: ToolExecutionContext
        ): Promise<FileSystemService> => {
            const injectedService = resolveInjectedService(context);
            if (injectedService) {
                const approvalManager = context.services?.approval;
                if (!approvalManager) {
                    throw ToolError.configInvalid(
                        'filesystem-tools requires ToolExecutionContext.services.approval'
                    );
                }
                injectedService.setDirectoryApprovalChecker((filePath: string) =>
                    approvalManager.isDirectoryApproved(filePath)
                );
                applyWorkspace(context, injectedService);
                return injectedService;
            }

            if (fileSystemService) {
                const approvalManager = context.services?.approval;
                if (!approvalManager) {
                    throw ToolError.configInvalid(
                        'filesystem-tools requires ToolExecutionContext.services.approval'
                    );
                }
                fileSystemService.setDirectoryApprovalChecker((filePath: string) =>
                    approvalManager.isDirectoryApproved(filePath)
                );
                applyWorkspace(context, fileSystemService);
                return fileSystemService;
            }

            const logger = context.logger;

            fileSystemService = new FileSystemService(fileSystemConfig, logger);

            const approvalManager = context.services?.approval;
            if (!approvalManager) {
                throw ToolError.configInvalid(
                    'filesystem-tools requires ToolExecutionContext.services.approval'
                );
            }
            fileSystemService.setDirectoryApprovalChecker((filePath: string) =>
                approvalManager.isDirectoryApproved(filePath)
            );
            applyWorkspace(context, fileSystemService);

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
