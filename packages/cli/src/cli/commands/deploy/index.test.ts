import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockCreateWorkspaceSnapshot,
    mockDeleteCloudAgent,
    mockDeployWorkspace,
    mockLoadDeployConfig,
    mockLoadWorkspaceDeployLink,
    mockOutro,
    mockRemoveWorkspaceDeployLink,
    mockSaveWorkspaceDeployLink,
    mockSpinner,
} = vi.hoisted(() => ({
    mockCreateWorkspaceSnapshot: vi.fn(),
    mockDeleteCloudAgent: vi.fn(),
    mockDeployWorkspace: vi.fn(),
    mockLoadDeployConfig: vi.fn(),
    mockLoadWorkspaceDeployLink: vi.fn(),
    mockOutro: vi.fn(),
    mockRemoveWorkspaceDeployLink: vi.fn(),
    mockSaveWorkspaceDeployLink: vi.fn(),
    mockSpinner: {
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
    },
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
        getCloudAgent: vi.fn(),
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
        mockDeployWorkspace.mockResolvedValue({
            cloudAgentId: 'cloud-agent-a',
            agentUrl: 'https://sandbox.dexto.ai/api/cloud-agents/cloud-agent-a/agent',
            state: { status: 'ready' },
        });
        mockDeleteCloudAgent.mockResolvedValue({
            cloudAgentId: 'cloud-agent-a',
        });
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
});
