import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceManager } from '@dexto/core/workspace';
import type { WorkspaceContext } from '@dexto/core/workspace';
import type { Logger } from '@dexto/core/logger';
import type { ToolExecutionContext, ToolServices } from '@dexto/core/tools';
import { processToolsFactory } from '@dexto/tools-process';
import { LocalWorkspaceHandleProvider } from './local-workspace-handle-provider.js';

function createLogger(): Logger {
    const logger: Partial<Logger> = {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        createChild: () => createLogger(),
    };
    return logger as Logger;
}

function createWorkspaceStore() {
    const workspaces = new Map<string, WorkspaceContext>();
    let currentId: string | undefined;
    return {
        saveWorkspace: async ({ workspace }: { workspace: WorkspaceContext }) => {
            workspaces.set(workspace.id, workspace);
        },
        getWorkspace: async ({ id }: { id: string }) => workspaces.get(id),
        findWorkspaceByPath: async ({ path: workspacePath }: { path: string }) =>
            [...workspaces.values()].find((workspace) => workspace.path === workspacePath),
        listWorkspaces: async () => [...workspaces.values()],
        setCurrentWorkspace: async ({ id }: { id: string }) => {
            currentId = id;
        },
        getCurrentWorkspaceId: async () => currentId,
        clearCurrentWorkspace: async () => {
            currentId = undefined;
        },
    };
}

describe('bash_exec in a workspace', () => {
    let directory: string;

    beforeEach(async () => {
        directory = await mkdtemp(path.join(tmpdir(), 'workspace-bash-'));
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(directory, { recursive: true, force: true });
    });

    async function runForeground(command: string, config: Record<string, unknown> = {}) {
        const workspaceManager = new WorkspaceManager(
            createWorkspaceStore(),
            { emit: () => true } as never,
            createLogger(),
            new LocalWorkspaceHandleProvider()
        );
        await workspaceManager.setWorkspace({ path: directory });

        const bashExec = processToolsFactory
            .create(
                processToolsFactory.configSchema.parse({
                    type: 'process-tools',
                    securityLevel: 'permissive',
                    ...config,
                })
            )
            .find((tool) => tool.id === 'bash_exec');
        if (bashExec === undefined) {
            throw new Error('Expected bash_exec tool to be registered.');
        }

        const context: ToolExecutionContext = {
            logger: createLogger(),
            services: { workspaceManager } as unknown as ToolServices,
        };
        return await bashExec.execute(
            { command, run_in_background: false, timeout: 20000 },
            context
        );
    }

    const printVariables =
        'echo "${DEXTO_TEST_HOST_MARKER:-absent}|${DEXTO_TEST_CONFIGURED:-absent}|${DEXTO_TEST_FORWARDED:-absent}"';

    it('does not pass host variables to the command, but passes configured ones', async () => {
        vi.stubEnv('DEXTO_TEST_HOST_MARKER', 'leaked-host-value');
        vi.stubEnv('DEXTO_TEST_FORWARDED', 'forwarded-host-value');

        const result = await runForeground(printVariables, {
            environment: { DEXTO_TEST_CONFIGURED: 'configured-value' },
        });

        expect(result).toMatchObject({ stdout: 'absent|configured-value|absent\n' });
    });

    it('forwards host variables the user names in passEnvironment', async () => {
        vi.stubEnv('DEXTO_TEST_HOST_MARKER', 'leaked-host-value');
        vi.stubEnv('DEXTO_TEST_FORWARDED', 'forwarded-host-value');

        const result = await runForeground(printVariables, {
            passEnvironment: ['DEXTO_TEST_FORWARDED'],
        });

        expect(result).toMatchObject({ stdout: 'absent|absent|forwarded-host-value\n' });
    });

    it('still finds commands on PATH', async () => {
        const result = await runForeground('echo ready');

        expect(result).toMatchObject({ stdout: 'ready\n' });
    });
});
