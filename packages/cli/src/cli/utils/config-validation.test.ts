import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '@dexto/agent-config';
import { z } from 'zod';

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

vi.mock('@dexto/agent-config', () => ({
    AgentConfigSchema: z
        .object({
            systemPrompt: z.string(),
            llm: z
                .object({
                    provider: z.string(),
                    model: z.string(),
                    baseURL: z.string().optional(),
                    apiKey: z.string().optional(),
                })
                .strict(),
            permissions: z
                .object({
                    mode: z.string(),
                    allowedToolsStorage: z.string(),
                })
                .strict()
                .optional(),
        })
        .strict(),
}));

vi.mock('@dexto/core', () => ({
    getPrimaryApiKeyEnvVar: vi.fn((provider: string) => {
        if (provider === 'openai-compatible') {
            return 'OPENAI_API_KEY';
        }
        return 'TEST_API_KEY';
    }),
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
    },
    requiresApiKey: vi.fn((provider: string) => provider !== 'openai-compatible'),
    requiresBaseURL: vi.fn((provider: string) => provider === 'openai-compatible'),
    resolveApiKeyForProvider: vi.fn(() => undefined),
}));

vi.mock('@dexto/agent-management', () => ({
    getGlobalPreferencesPath: vi.fn(() => '/tmp/.dexto/preferences.yml'),
}));

describe('validateAgentConfig', () => {
    let validateAgentConfig: typeof import('./config-validation.js').validateAgentConfig;

    beforeAll(async () => {
        ({ validateAgentConfig } = await import('./config-validation.js'));
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mockIsCancel.mockReturnValue(false);
        mockSelect.mockResolvedValue('skip');
        mockGetBundledSyncTargetForAgentPath.mockReturnValue(null);
    });

    it('accepts ChatGPT Login codex base URLs during preflight validation', async () => {
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
