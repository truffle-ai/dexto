import type { ToolFactory } from '@dexto/agent-config';
import type { ToolExecutionContext } from '@dexto/core/tools';
import type { WorkspaceHandle } from '@dexto/core/workspace';
import { ProcessService } from './process-service.js';
import { createBashExecTool } from './bash-exec-tool.js';
import { createBashOutputTool } from './bash-output-tool.js';
import { createKillProcessTool } from './kill-process-tool.js';
import { ProcessToolsConfigSchema, type ProcessToolsConfig } from './tool-factory-config.js';
import { CommandValidator } from './command-validator.js';
import { ProcessError } from './errors.js';
import type { ExecuteOptions, ProcessConfig, ProcessOutput } from './types.js';
import type { ProcessCommandService } from './bash-exec-tool.js';
import { WorkspaceErrorCodes } from '@dexto/core/workspace';

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

        const getProcessService = async (
            context: ToolExecutionContext,
            options: { background?: boolean } = {}
        ): Promise<ProcessCommandService> => {
            const workspaceProcessService =
                options.background === true
                    ? null
                    : await createWorkspaceProcessService(context, processConfig);
            if (workspaceProcessService !== null) {
                return workspaceProcessService;
            }

            const injectedService = resolveInjectedService(context);
            if (injectedService) {
                applyWorkspace(context, injectedService);
                return injectedService;
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

async function createWorkspaceProcessService(
    context: ToolExecutionContext,
    processConfig: ProcessConfig
): Promise<WorkspaceProcessService | null> {
    const workspaceManager = context.services?.workspaceManager;
    if (workspaceManager === undefined) {
        return null;
    }

    let handle: WorkspaceHandle;
    try {
        handle = await workspaceManager.open({ intent: 'process' });
    } catch (error) {
        if (isWorkspaceUnavailable(error)) {
            return null;
        }
        throw error;
    }
    if (handle.processes === undefined) {
        return null;
    }

    return new WorkspaceProcessService(processConfig, context, handle);
}

function isWorkspaceUnavailable(error: unknown): boolean {
    if (
        typeof error === 'object' &&
        error !== null &&
        'issues' in error &&
        Array.isArray(error.issues)
    ) {
        return error.issues.some(
            (issue) =>
                typeof issue === 'object' &&
                issue !== null &&
                'code' in issue &&
                (issue.code === WorkspaceErrorCodes.CURRENT_WORKSPACE_REQUIRED ||
                    issue.code === WorkspaceErrorCodes.HANDLE_PROVIDER_REQUIRED)
        );
    }

    return false;
}

class WorkspaceProcessService implements ProcessCommandService {
    private readonly commandValidator: CommandValidator;

    constructor(
        private readonly processConfig: ProcessConfig,
        private readonly context: ToolExecutionContext,
        private readonly handle: WorkspaceHandle
    ) {
        this.commandValidator = new CommandValidator(processConfig, context.logger);
    }

    async executeCommand(command: string, options: ExecuteOptions = {}) {
        if (options.runInBackground === true) {
            throw ProcessError.executionFailed(
                command,
                'Workspace process handles do not support background execution yet'
            );
        }

        const validation = this.commandValidator.validateCommand(command);
        if (!validation.isValid || !validation.normalizedCommand) {
            throw ProcessError.invalidCommand(command, validation.error || 'Unknown error');
        }

        const startedAt = Date.now();
        const result = await this.handle.processes?.exec({
            command: validation.normalizedCommand,
            ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
            ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
        });

        if (result === undefined) {
            throw ProcessError.executionFailed(command, 'Workspace process execution unavailable');
        }

        return {
            duration: Date.now() - startedAt,
            exitCode: result.exitCode ?? 0,
            stderr: result.stderr,
            stdout: result.stdout,
        };
    }

    getConfig(): Readonly<ProcessConfig> {
        return {
            ...this.processConfig,
            workingDirectory: this.handle.context.path,
        };
    }

    async getProcessOutput(processId: string): Promise<ProcessOutput> {
        throw ProcessError.processNotFound(processId);
    }

    async killProcess(processId: string): Promise<void> {
        throw ProcessError.processNotFound(processId);
    }
}
