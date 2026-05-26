import { describe, expect, it, vi } from 'vitest';
import { WorkspaceManager } from './manager.js';
import type { WorkspaceContext, WorkspaceHandleProvider } from './types.js';
import { WorkspaceErrorCodes } from './error-codes.js';
import type { DextoValidationError } from '../errors/DextoValidationError.js';
import type { WorkspaceStore } from '../storage/workspaces/types.js';
import { createMockLogger } from '../logger/v2/test-utils.js';

function createWorkspaceStore(): WorkspaceStore {
    const workspaces = new Map<string, WorkspaceContext>();
    let currentId: string | undefined;

    return {
        saveWorkspace: vi.fn(async ({ workspace }) => {
            workspaces.set(workspace.id, workspace);
        }),
        getWorkspace: vi.fn(async ({ id }) => workspaces.get(id)),
        findWorkspaceByPath: vi.fn(async ({ path }) =>
            [...workspaces.values()].find((workspace) => workspace.path === path)
        ),
        listWorkspaces: vi.fn(async () => [...workspaces.values()]),
        setCurrentWorkspace: vi.fn(async ({ id }) => {
            currentId = id;
        }),
        getCurrentWorkspaceId: vi.fn(async () => currentId),
        clearCurrentWorkspace: vi.fn(async () => {
            currentId = undefined;
        }),
    };
}

function createManager(
    store = createWorkspaceStore(),
    provider?: WorkspaceHandleProvider
): WorkspaceManager {
    return new WorkspaceManager(
        store,
        {
            emit: vi.fn(),
        } as any,
        createMockLogger(),
        provider
    );
}

describe('WorkspaceManager', () => {
    it('open delegates current workspace and input to the provider', async () => {
        const handle = {
            context: {
                id: 'workspace-id',
                path: '/repo',
                createdAt: 1,
                lastActiveAt: 2,
            },
            capabilities: ['files' as const],
            files: {
                readFile: vi.fn(),
                readText: vi.fn(),
                glob: vi.fn(),
                writeFile: vi.fn(),
                listFiles: vi.fn(),
            },
        };
        const provider = {
            open: vi.fn(async () => handle),
        };
        const manager = createManager(createWorkspaceStore(), provider);
        const workspace = await manager.setWorkspace({ path: '/repo' });

        await expect(manager.open({ capabilities: ['files'] })).resolves.toBe(handle);
        expect(provider.open).toHaveBeenCalledWith({
            context: workspace,
            input: { capabilities: ['files'] },
        });
    });

    it('open fails clearly without a current workspace', async () => {
        const provider = {
            open: vi.fn(),
        };
        const manager = createManager(createWorkspaceStore(), provider);

        const error = (await manager.open().catch((caught) => caught)) as DextoValidationError;

        expect(error.errors[0]?.code).toBe(WorkspaceErrorCodes.CURRENT_WORKSPACE_REQUIRED);
        expect(error.errors[0]?.path).toEqual(['currentWorkspace']);
        expect(provider.open).not.toHaveBeenCalled();
    });

    it('open fails clearly without a provider', async () => {
        const manager = createManager();
        await manager.setWorkspace({ path: '/repo' });

        const error = (await manager.open().catch((caught) => caught)) as DextoValidationError;

        expect(error.errors[0]?.code).toBe(WorkspaceErrorCodes.HANDLE_PROVIDER_REQUIRED);
        expect(error.errors[0]?.path).toEqual(['handleProvider']);
    });
});
