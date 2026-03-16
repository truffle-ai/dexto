import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockCreateWorkspaceSnapshot,
    mockLoadDeployConfig,
    mockLoadWorkspaceDeployLink,
    mockSpinner,
} = vi.hoisted(() => ({
    mockCreateWorkspaceSnapshot: vi.fn(),
    mockLoadDeployConfig: vi.fn(),
    mockLoadWorkspaceDeployLink: vi.fn(),
    mockSpinner: {
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
    },
}));

vi.mock('@clack/prompts', () => ({
    intro: vi.fn(),
    note: vi.fn(),
    outro: vi.fn(),
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
        deployWorkspace: vi.fn(),
        getCloudAgent: vi.fn(),
        stopCloudAgent: vi.fn(),
        deleteCloudAgent: vi.fn(),
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
    saveWorkspaceDeployLink: vi.fn(),
    removeWorkspaceDeployLink: vi.fn(),
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
});
