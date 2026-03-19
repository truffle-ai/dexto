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
    mockLoadAgentConfig,
    mockListCloudAgents,
    mockLoadDeployConfig,
    mockLoadWorkspaceDeployLink,
    mockOpenBrowser,
    mockOutro,
    mockRemoveWorkspaceDeployLink,
    mockSaveWorkspaceDeployLink,
    mockSpinner,
    mockStartCloudChatCli,
    mockValidateAgentConfig,
} = vi.hoisted(() => ({
    mockCreateWorkspaceSnapshot: vi.fn(),
    mockDeleteCloudAgent: vi.fn(),
    mockDeployWorkspace: vi.fn(),
    mockFindDextoProjectRoot: vi.fn(),
    mockGetCloudAgent: vi.fn(),
    mockLoadAgentConfig: vi.fn(),
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
    mockStartCloudChatCli: vi.fn(),
    mockValidateAgentConfig: vi.fn(),
}));

vi.mock('@dexto/agent-management', () => ({
    findDextoProjectRoot: mockFindDextoProjectRoot,
    loadAgentConfig: mockLoadAgentConfig,
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

vi.mock('../../cloud-chat.js', () => ({
    startCloudChatCli: mockStartCloudChatCli,
}));

vi.mock('../../utils/config-validation.js', () => ({
    validateAgentConfig: mockValidateAgentConfig,
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
        mockLoadAgentConfig.mockResolvedValue({
            llm: { provider: 'openai', model: 'gpt-5.3-codex', apiKey: '$OPENAI_API_KEY' },
        });
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
        mockValidateAgentConfig.mockResolvedValue({
            success: true,
            config: {
                llm: { provider: 'openai', model: 'gpt-5.3-codex', apiKey: '$OPENAI_API_KEY' },
            },
            warnings: [],
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

    it('validates workspace agents before uploading the workspace snapshot', async () => {
        mockLoadDeployConfig.mockResolvedValue({
            version: 1,
            agent: { type: 'workspace', path: 'agents/review-agent/review-agent.yml' },
            exclude: [],
        });
        const cleanup = vi.fn().mockResolvedValue(undefined);
        mockCreateWorkspaceSnapshot.mockResolvedValue({
            archivePath: '/tmp/workspace.tgz',
            cleanup,
        });
        const { resolveWorkspaceDeployAgentPath } = await import('./config.js');
        vi.mocked(resolveWorkspaceDeployAgentPath).mockReturnValue(
            path.join(tempDir, 'agents', 'review-agent', 'review-agent.yml')
        );
        fs.mkdirSync(path.join(tempDir, 'agents', 'review-agent'), { recursive: true });
        fs.writeFileSync(
            path.join(tempDir, 'agents', 'review-agent', 'review-agent.yml'),
            'llm: {}'
        );
        mockValidateAgentConfig.mockResolvedValueOnce({
            success: false,
            errors: ['llm.model: unsupported model'],
        });

        const { handleDeployCommand } = await import('./index.js');

        await expect(handleDeployCommand()).rejects.toThrow(
            'Workspace agent validation failed for agents/review-agent/review-agent.yml'
        );

        expect(mockLoadAgentConfig).toHaveBeenCalledWith(
            path.join(tempDir, 'agents', 'review-agent', 'review-agent.yml')
        );
        expect(mockValidateAgentConfig).toHaveBeenCalledWith(
            expect.any(Object),
            false,
            expect.objectContaining({
                agentPath: 'agents/review-agent/review-agent.yml',
                credentialPolicy: 'error',
            })
        );
        expect(mockCreateWorkspaceSnapshot).not.toHaveBeenCalled();
        expect(mockDeployWorkspace).not.toHaveBeenCalled();
        expect(cleanup).not.toHaveBeenCalled();
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
});
