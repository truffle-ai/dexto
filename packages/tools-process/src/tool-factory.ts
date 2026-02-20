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
        const injectedServiceScopes = new WeakMap<ProcessService, Map<string, ProcessService>>();

        const resolveWorkingDirectory = (context: ToolExecutionContext): string =>
            context.workspace?.path ?? processConfig.workingDirectory ?? process.cwd();

        const applyWorkspace = (context: ToolExecutionContext, service: ProcessService) => {
            const workingDirectory = resolveWorkingDirectory(context);
            service.setWorkingDirectory(workingDirectory);
        };

        const resolveInjectedService = (context: ToolExecutionContext): ProcessService | null => {
            const candidate = (context.services as unknown as { processService?: unknown })
                ?.processService as ProcessService | undefined;
            if (!candidate) return null;
            if (candidate instanceof ProcessService) return candidate;
            const hasMethods =
                typeof (candidate as ProcessService).executeCommand === 'function' &&
                typeof (candidate as ProcessService).killProcess === 'function' &&
                typeof (candidate as ProcessService).setWorkingDirectory === 'function' &&
                typeof (candidate as ProcessService).getConfig === 'function';
            return hasMethods ? (candidate as ProcessService) : null;
        };

        const getScopedInjectedService = (
            context: ToolExecutionContext,
            injectedService: ProcessService
        ): ProcessService => {
            const workingDirectory = resolveWorkingDirectory(context);
            let scopedServices = injectedServiceScopes.get(injectedService);
            if (!scopedServices) {
                scopedServices = new Map();
                injectedServiceScopes.set(injectedService, scopedServices);
            }

            const existing = scopedServices.get(workingDirectory);
            if (existing) {
                return existing;
            }

            const logger = context.logger;
            const baseConfig = injectedService.getConfig();
            const scopedConfig: ProcessConfig = { ...baseConfig, workingDirectory };
            const scopedService = new ProcessService(scopedConfig, logger);
            scopedService.initialize().catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`Failed to initialize ProcessService: ${message}`);
            });
            scopedServices.set(workingDirectory, scopedService);
            return scopedService;
        };

        const getProcessService = async (
            context: ToolExecutionContext
        ): Promise<ProcessService> => {
            const injectedService = resolveInjectedService(context);
            if (injectedService) {
                const scopedService = getScopedInjectedService(context, injectedService);
                return scopedService;
            }

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
