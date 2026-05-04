import { WorkspaceError } from '@dexto/core/workspace';
import type { ToolExecutionContext, ToolServices } from '@dexto/core/tools';
import type { Logger } from '@dexto/core/logger';
import { describe, expect, it, vi } from 'vitest';
import { processToolsFactory } from './tool-factory.js';
import { ProcessToolsConfigSchema } from './tool-factory-config.js';
import type { ProcessConfig, ProcessOutput } from './types.js';

const processConfig = ProcessToolsConfigSchema.parse({ type: 'process-tools' });

describe('processToolsFactory', () => {
    it('executes foreground bash commands through a workspace process handle when available', async () => {
        const exec = vi.fn(async () => ({
            exitCode: 7,
            stderr: 'not clean',
            stdout: 'changed files',
        }));
        const open = vi.fn(async () => ({
            capabilities: ['files', 'processes'],
            context: {
                createdAt: 1,
                id: 'workspace-1',
                lastActiveAt: 1,
                path: '/workspace',
            },
            files: {},
            processes: { exec },
        }));
        const bashExec = processToolsFactory
            .create(processConfig)
            .find((tool) => tool.id === 'bash_exec');

        if (bashExec === undefined) {
            throw new Error('Expected bash_exec tool to be registered.');
        }

        const result = await bashExec.execute(
            {
                command: 'git status',
                cwd: 'src',
                run_in_background: false,
                timeout: 5000,
            },
            createToolContext({
                workspaceManager: {
                    open,
                },
            })
        );

        expect(open).toHaveBeenCalledWith({ intent: 'process' });
        expect(exec).toHaveBeenCalledWith({
            command: 'git status',
            cwd: '/workspace/src',
            timeout: 5000,
        });
        expect(result).toMatchObject({
            exit_code: 7,
            stderr: 'not clean',
            stdout: 'changed files',
        });
    });

    it('keeps the existing process service path when no workspace is active', async () => {
        const processService = new FakeProcessCommandService();
        const bashExec = processToolsFactory
            .create(processConfig)
            .find((tool) => tool.id === 'bash_exec');

        if (bashExec === undefined) {
            throw new Error('Expected bash_exec tool to be registered.');
        }

        const result = await bashExec.execute(
            {
                command: 'pwd',
                run_in_background: false,
                timeout: 5000,
            },
            createToolContext({
                processService,
                workspaceManager: {
                    open: async () => {
                        throw WorkspaceError.currentWorkspaceRequired();
                    },
                },
            })
        );

        expect(processService.commands).toEqual([
            {
                command: 'pwd',
                options: {
                    abortSignal: undefined,
                    cwd: undefined,
                    description: undefined,
                    runInBackground: false,
                    timeout: 5000,
                },
            },
        ]);
        expect(result).toMatchObject({
            exit_code: 0,
            stderr: '',
            stdout: '/local\n',
        });
    });
});

function createToolContext(services: Record<string, unknown>): ToolExecutionContext {
    return {
        logger: createLogger() as unknown as Logger,
        services: services as unknown as ToolServices,
    };
}

function createLogger() {
    return {
        createChild: () => createLogger(),
        debug: () => {},
        error: () => {},
        info: () => {},
        warn: () => {},
    };
}

class FakeProcessCommandService {
    readonly commands: Array<{
        command: string;
        options: unknown;
    }> = [];

    async executeCommand(command: string, options: unknown) {
        this.commands.push({ command, options });
        return {
            duration: 10,
            exitCode: 0,
            stderr: '',
            stdout: '/local\n',
        };
    }

    getConfig(): Readonly<ProcessConfig> {
        return {
            allowedCommands: [],
            blockedCommands: [],
            environment: {},
            maxConcurrentProcesses: 5,
            maxOutputBuffer: 1024,
            maxTimeout: 600000,
            securityLevel: 'moderate',
            workingDirectory: '/local',
        };
    }

    async getProcessOutput(_processId: string): Promise<ProcessOutput> {
        return {
            status: 'completed',
            stderr: '',
            stdout: '',
        };
    }

    async killProcess(_processId: string): Promise<void> {}

    setWorkingDirectory(_workingDirectory: string): void {}
}
