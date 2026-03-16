import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '@dexto/agent-config';

const {
    mockSelect,
    mockIsCancel,
    mockHandleSyncAgentsCommand,
    mockGetBundledSyncTargetForAgentPath,
} = vi.hoisted(() => ({
    mockSelect: vi.fn(),
    mockIsCancel: vi.fn(() => false),
    mockHandleSyncAgentsCommand: vi.fn(),
    mockGetBundledSyncTargetForAgentPath: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
    select: mockSelect,
    isCancel: mockIsCancel,
    outro: vi.fn(),
    note: vi.fn(),
    log: {
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('../commands/agents/sync.js', () => ({
    handleSyncAgentsCommand: mockHandleSyncAgentsCommand,
    getBundledSyncTargetForAgentPath: mockGetBundledSyncTargetForAgentPath,
}));

describe('validateAgentConfig', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsCancel.mockReturnValue(false);
        mockSelect.mockResolvedValue('skip');
        mockGetBundledSyncTargetForAgentPath.mockReturnValue(null);
    });

    it('accepts ChatGPT Login codex base URLs during preflight validation', async () => {
        const { validateAgentConfig } = await import('./config-validation.js');

        const config: AgentConfig = {
            systemPrompt: 'test agent',
            llm: {
                provider: 'openai-compatible',
                model: 'gpt-5',
                baseURL: 'codex://chatgpt',
            },
            permissions: {
                mode: 'manual',
                allowedToolsStorage: 'storage',
            },
        };

        const result = await validateAgentConfig(config, false, {
            credentialPolicy: 'error',
        });

        expect(result).toEqual({
            success: true,
            config: expect.objectContaining({
                llm: expect.objectContaining({
                    provider: 'openai-compatible',
                    model: 'gpt-5',
                    baseURL: 'codex://chatgpt',
                }),
            }),
            warnings: [],
        });
    });

    it('does not offer sync when the active agent path is not a bundled installed agent', async () => {
        const { validateAgentConfig } = await import('./config-validation.js');

        const invalidConfig = {
            systemPrompt: 'test agent',
            llm: {
                provider: 'openai-compatible',
            },
        } as unknown as AgentConfig;

        const result = await validateAgentConfig(invalidConfig, true, {
            agentPath: '/workspace/agents/custom-agent.yml',
        });

        const options = mockSelect.mock.calls[0]?.[0]?.options as Array<{ value: string }>;

        expect(options.map((option) => option.value)).toEqual(['skip', 'edit']);
        expect(result).toEqual(
            expect.objectContaining({
                success: false,
                skipped: true,
            })
        );
        expect(mockHandleSyncAgentsCommand).not.toHaveBeenCalled();
    });

    it('offers sync when the active config is a bundled installed agent', async () => {
        const { validateAgentConfig } = await import('./config-validation.js');

        mockGetBundledSyncTargetForAgentPath.mockReturnValue({
            agentId: 'coding-agent',
            agentEntry: {
                id: 'coding-agent',
                name: 'Coding Agent',
                source: 'coding-agent/',
                main: 'coding-agent.yml',
            },
        });

        const invalidConfig = {
            systemPrompt: 'test agent',
            llm: {
                provider: 'openai-compatible',
            },
        } as unknown as AgentConfig;

        await validateAgentConfig(invalidConfig, true, {
            agentPath: '/Users/test/.dexto/agents/coding-agent/coding-agent.yml',
        });

        const options = mockSelect.mock.calls[0]?.[0]?.options as Array<{ value: string }>;

        expect(options.map((option) => option.value)).toEqual(['sync', 'skip', 'edit']);
    });
});
