import type { ToolFactory } from '@dexto/agent-config';
import type { ToolExecutionContext } from '@dexto/core';
import { ProcessService } from './process-service.js';
import { createBashExecTool } from './bash-exec-tool.js';
import { createBashOutputTool } from './bash-output-tool.js';
import { createKillProcessTool } from './kill-process-tool.js';
import { ProcessToolsConfigSchema, type ProcessToolsConfig } from './tool-factory-config.js';
import type { ProcessConfig } from './types.js';

export const processToolsFactory: ToolFactory<ProcessToolsConfig> = {
    configSchema: ProcessToolsConfigSchema,
    metadata: {
        displayName: 'Process Tools',
        description: 'Process execution and management (bash, output, kill)',
        category: 'process',
    },
    create: (config) => {
        const processConfig: ProcessConfig = {
            securityLevel: config.securityLevel,
            maxTimeout: config.maxTimeout,
            maxConcurrentProcesses: config.maxConcurrentProcesses,
            maxOutputBuffer: config.maxOutputBuffer,
            workingDirectory: config.workingDirectory ?? process.cwd(),
            allowedCommands: config.allowedCommands,
            blockedCommands: config.blockedCommands,
            environment: config.environment,
        };

        let processService: ProcessService | undefined;

        const resolveWorkingDirectory = (context: ToolExecutionContext): string =>
            context.workspace?.path ?? processConfig.workingDirectory ?? process.cwd();

        const applyWorkspace = (context: ToolExecutionContext, service: ProcessService) => {
            const workingDirectory = resolveWorkingDirectory(context);
            service.setWorkingDirectory(workingDirectory);
        };

        const getProcessService = async (
            context: ToolExecutionContext
        ): Promise<ProcessService> => {
            if (processService) {
                applyWorkspace(context, processService);
                return processService;
            }

            const logger = context.logger;

            processService = new ProcessService(processConfig, logger);
            applyWorkspace(context, processService);
            processService.initialize().catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`Failed to initialize ProcessService: ${message}`);
            });

            return processService;
        };

        return [
            createBashExecTool(getProcessService),
            createBashOutputTool(getProcessService),
            createKillProcessTool(getProcessService),
        ];
    },
};
