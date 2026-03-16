import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockCreateWorkspaceSnapshot,
    mockDeleteCloudAgent,
    mockDeployWorkspace,
    mockFindDextoProjectRoot,
    mockGetCloudAgent,
    mockListCloudAgents,
    mockLoadDeployConfig,
    mockLoadWorkspaceDeployLink,
    mockOpenBrowser,
    mockOutro,
    mockRemoveWorkspaceDeployLink,
    mockSaveWorkspaceDeployLink,
    mockSpinner,
} = vi.hoisted(() => ({
    mockCreateWorkspaceSnapshot: vi.fn(),
    mockDeleteCloudAgent: vi.fn(),
    mockDeployWorkspace: vi.fn(),
    mockFindDextoProjectRoot: vi.fn(),
    mockGetCloudAgent: vi.fn(),
    mockListCloudAgents: vi.fn(),
    mockLoadDeployConfig: vi.fn(),
    mockLoadWorkspaceDeployLink: vi.fn(),
    mockOpenBrowser: vi.fn(),
    mockOutro: vi.fn(),
    mockRemoveWorkspaceDeployLink: vi.fn(),
    mockSaveWorkspaceDeployLink: vi.fn(),
    mockSpinner: {
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
    },
}));

vi.mock('@dexto/agent-management', () => ({
    findDextoProjectRoot: mockFindDextoProjectRoot,
}));

vi.mock('@clack/prompts', () => ({
    intro: vi.fn(),
    note: vi.fn(),
    outro: mockOutro,
    spinner: vi.fn(() => mockSpinner),
}));

vi.mock('./config.js', () => ({
    createCloudDefaultDeployConfig: vi.fn(() => ({
        version: 1,
        agent: { type: 'cloud-default' },
        exclude: [],
    })),
    createWorkspaceDeployConfig: vi.fn(),
    getDeployConfigPath: vi.fn((workspaceRoot: string) =>
        path.join(workspaceRoot, '.dexto', 'deploy.json')
    ),
    isWorkspaceDeployAgent: vi.fn(
        (agent: { type: 'cloud-default' | 'workspace' }) => agent.type === 'workspace'
    ),
    loadDeployConfig: mockLoadDeployConfig,
    resolveWorkspaceDeployAgentPath: vi.fn(),
    saveDeployConfig: vi.fn(),
}));

vi.mock('./client.js', () => ({
    createDeployClient: vi.fn(() => ({
        deployWorkspace: mockDeployWorkspace,
        getCloudAgent: mockGetCloudAgent,
        listCloudAgents: mockListCloudAgents,
        stopCloudAgent: vi.fn(),
        deleteCloudAgent: mockDeleteCloudAgent,
    })),
}));

vi.mock('./entry-agent.js', () => ({
    discoverPrimaryWorkspaceAgent: vi.fn().mockResolvedValue(null),
    isAgentYamlPath: vi.fn(() => true),
}));

vi.mock('./links.js', () => ({
    getCloudAgentDashboardUrl: vi.fn(
        (cloudAgentId: string) => `https://app.dexto.ai/${cloudAgentId}`
    ),
}));

vi.mock('./state.js', () => ({
    loadWorkspaceDeployLink: mockLoadWorkspaceDeployLink,
    saveWorkspaceDeployLink: mockSaveWorkspaceDeployLink,
    removeWorkspaceDeployLink: mockRemoveWorkspaceDeployLink,
}));

vi.mock('open', () => ({
    default: mockOpenBrowser,
}));

vi.mock('./snapshot.js', () => ({
    createWorkspaceSnapshot: mockCreateWorkspaceSnapshot,
}));

function createTempDir(): string {
    return fs.mkdtempSync(path.join(tmpdir(), 'dexto-deploy-index-'));
}

describe('deploy command', () => {
    let tempDir: string;
    let originalCwd: string;

    beforeEach(() => {
        vi.clearAllMocks();
        tempDir = createTempDir();
        originalCwd = process.cwd();
        process.chdir(tempDir);

        mockLoadDeployConfig.mockResolvedValue({
            version: 1,
            agent: { type: 'cloud-default' },
            exclude: [],
        });
        mockLoadWorkspaceDeployLink.mockResolvedValue(null);
        mockFindDextoProjectRoot.mockReturnValue(null);
        mockOpenBrowser.mockResolvedValue(undefined);
        mockDeployWorkspace.mockResolvedValue({
            cloudAgentId: 'cloud-agent-a',
            agentUrl: 'https://sandbox.dexto.ai/api/cloud-agents/cloud-agent-a/agent',
            state: { status: 'ready' },
        });
        mockDeleteCloudAgent.mockResolvedValue({
            cloudAgentId: 'cloud-agent-a',
        });
        mockGetCloudAgent.mockResolvedValue({
            cloudAgentId: 'cloud-agent-a',
            agentUrl: 'https://sandbox.dexto.ai/api/cloud-agents/cloud-agent-a/agent',
            state: { status: 'ready' },
        });
        mockListCloudAgents.mockResolvedValue([
            {
                cloudAgentId: 'cloud-agent-a',
                name: 'Workspace Alpha',
                agentUrl: 'https://sandbox.dexto.ai/api/cloud-agents/cloud-agent-a/agent',
                state: { status: 'ready' },
            },
            {
                cloudAgentId: 'cloud-agent-b',
                name: null,
                agentUrl: 'https://sandbox.dexto.ai/api/cloud-agents/cloud-agent-b/agent',
                state: { status: 'stopped' },
            },
        ]);
        mockSaveWorkspaceDeployLink.mockResolvedValue(undefined);
        mockRemoveWorkspaceDeployLink.mockResolvedValue(undefined);
    });

    afterEach(() => {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('stops the spinner when snapshot packaging fails', async () => {
        mockCreateWorkspaceSnapshot.mockRejectedValue(new Error('packaging failed'));

        const { handleDeployCommand } = await import('./index.js');

        await expect(handleDeployCommand()).rejects.toThrow('packaging failed');
        expect(mockSpinner.start).toHaveBeenCalledWith('Packaging workspace snapshot...');
        expect(mockSpinner.stop).toHaveBeenCalledWith(expect.stringContaining('Deploy failed'));
    });

    it('warns when deploy succeeds but local link state cannot be saved', async () => {
        const cleanup = vi.fn().mockResolvedValue(undefined);
        mockCreateWorkspaceSnapshot.mockResolvedValue({
            archivePath: '/tmp/workspace.tgz',
            cleanup,
        });
        mockSaveWorkspaceDeployLink.mockRejectedValue(new Error('disk full'));

        const { handleDeployCommand } = await import('./index.js');

        await expect(handleDeployCommand()).resolves.toBeUndefined();

        expect(mockSpinner.stop).toHaveBeenCalledWith(
            expect.stringContaining('Workspace deployed')
        );
        expect(mockOutro).toHaveBeenCalledWith(
            expect.stringContaining(
                'Warning: deployment succeeded, but failed to save local link state (disk full)'
            )
        );
        expect(mockOutro).toHaveBeenCalledWith(
            expect.stringContaining('Run `dexto deploy` again in this workspace to re-link.')
        );
        expect(cleanup).toHaveBeenCalled();
    });

    it('warns when delete succeeds but local link state cannot be removed', async () => {
        mockLoadWorkspaceDeployLink.mockResolvedValue({
            cloudAgentId: 'cloud-agent-a',
            updatedAt: new Date().toISOString(),
        });
        mockRemoveWorkspaceDeployLink.mockRejectedValue(new Error('permission denied'));

        const { handleDeployDeleteCommand } = await import('./index.js');

        await expect(handleDeployDeleteCommand({ interactive: false })).resolves.toBeUndefined();

        expect(mockSpinner.stop).toHaveBeenCalledWith(
            expect.stringContaining('Cloud deployment deleted')
        );
        expect(mockOutro).toHaveBeenCalledWith(
            expect.stringContaining(
                'Warning: failed to remove local deploy link state (permission denied)'
            )
        );
    });

    it('uses the resolved project root when DEXTO_PROJECT_ROOT points outside cwd', async () => {
        const projectRoot = tempDir;
        const nestedDir = path.join(tempDir, 'nested');
        fs.mkdirSync(nestedDir, { recursive: true });
        process.chdir(nestedDir);
        mockFindDextoProjectRoot.mockReturnValue(projectRoot);
        mockLoadWorkspaceDeployLink.mockResolvedValue({
            cloudAgentId: 'cloud-agent-a',
            updatedAt: new Date().toISOString(),
        });

        const { handleDeployStatusCommand } = await import('./index.js');

        await expect(handleDeployStatusCommand()).resolves.toBeUndefined();

        expect(mockLoadWorkspaceDeployLink).toHaveBeenCalledWith(projectRoot);
    });

    it('lists cloud deployments and highlights the linked workspace deployment', async () => {
        mockLoadWorkspaceDeployLink.mockResolvedValue({
            cloudAgentId: 'cloud-agent-a',
            updatedAt: new Date().toISOString(),
        });

        const { handleDeployListCommand } = await import('./index.js');

        await expect(handleDeployListCommand()).resolves.toBeUndefined();

        expect(mockListCloudAgents).toHaveBeenCalledTimes(1);
        expect(mockOutro).toHaveBeenCalledWith(expect.stringContaining('Cloud deployments'));
        expect(mockOutro).toHaveBeenCalledWith(expect.stringContaining('Linked to this workspace'));
        expect(mockOutro).toHaveBeenCalledWith(expect.stringContaining('Workspace Alpha'));
        expect(mockOutro).toHaveBeenCalledWith(expect.stringContaining('cloud-agent-b'));
    });

    it('opens the dashboard for the linked deployment', async () => {
        mockLoadWorkspaceDeployLink.mockResolvedValue({
            cloudAgentId: 'cloud-agent-a',
            updatedAt: new Date().toISOString(),
        });

        const { handleDeployOpenCommand } = await import('./index.js');

        await expect(handleDeployOpenCommand()).resolves.toBeUndefined();

        expect(mockOpenBrowser).toHaveBeenCalledWith('https://app.dexto.ai/cloud-agent-a');
        expect(mockOutro).toHaveBeenCalledWith(
            expect.stringContaining('Opened dashboard for cloud-agent-a')
        );
    });

    it('links the workspace to an existing cloud deployment', async () => {
        mockLoadWorkspaceDeployLink.mockResolvedValue({
            cloudAgentId: 'cloud-agent-previous',
            updatedAt: new Date().toISOString(),
        });
        mockGetCloudAgent.mockResolvedValue({
            cloudAgentId: 'cloud-agent-a',
            agentUrl: 'https://sandbox.dexto.ai/api/cloud-agents/cloud-agent-a/agent',
            state: { status: 'ready' },
        });

        const { handleDeployLinkCommand } = await import('./index.js');

        await expect(handleDeployLinkCommand('cloud-agent-a')).resolves.toBeUndefined();

        expect(mockSaveWorkspaceDeployLink).toHaveBeenCalledWith(fs.realpathSync.native(tempDir), {
            cloudAgentId: 'cloud-agent-a',
            agentUrl: 'https://sandbox.dexto.ai/api/cloud-agents/cloud-agent-a/agent',
        });
        expect(mockOutro).toHaveBeenCalledWith(
            expect.stringContaining('Replaced previous link: cloud-agent-previous')
        );
    });

    it('unlinks the workspace without deleting the remote deployment', async () => {
        mockLoadWorkspaceDeployLink.mockResolvedValue({
            cloudAgentId: 'cloud-agent-a',
            updatedAt: new Date().toISOString(),
        });

        const { handleDeployUnlinkCommand } = await import('./index.js');

        await expect(handleDeployUnlinkCommand()).resolves.toBeUndefined();

        expect(mockRemoveWorkspaceDeployLink).toHaveBeenCalledWith(fs.realpathSync.native(tempDir));
        expect(mockOutro).toHaveBeenCalledWith(
            expect.stringContaining('The remote deployment was not deleted.')
        );
    });
});
