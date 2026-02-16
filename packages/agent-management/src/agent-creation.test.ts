import { describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '@dexto/agent-config';

const loadImageMock = vi.fn(async (_specifier: string) => ({ defaults: {} }));
const resolveServicesFromConfigMock = vi.fn(async () => ({}));
const enrichAgentConfigMock = vi.fn((config: unknown) => config);

vi.mock('@dexto/agent-config', () => ({
    AgentConfigSchema: { parse: (config: unknown) => config },
    applyImageDefaults: (config: unknown) => config,
    cleanNullValues: (config: unknown) => config,
    loadImage: loadImageMock,
    resolveServicesFromConfig: resolveServicesFromConfigMock,
    toDextoAgentOptions: (options: unknown) => options,
}));

vi.mock('@dexto/core', () => {
    class MockDextoAgent {
        options: unknown;
        constructor(options: unknown) {
            this.options = options;
        }
    }

    return {
        DextoAgent: MockDextoAgent,
        logger: { debug: vi.fn() },
    };
});

vi.mock('@dexto/tools-builtins', () => ({
    BUILTIN_TOOL_NAMES: ['ask_user', 'invoke_skill', 'search_history'],
}));

vi.mock('./config/index.js', () => ({
    enrichAgentConfig: enrichAgentConfigMock,
}));

describe('createDextoAgentFromConfig', () => {
    it('applies sub-agent tool constraints (disable ask_user/invoke_skill and remove agent-spawner)', async () => {
        const previousEnv = process.env.DEXTO_IMAGE;
        delete process.env.DEXTO_IMAGE;

        try {
            const { createDextoAgentFromConfig } = await import('./agent-creation.js');

            const config = {
                llm: { provider: 'openai', model: 'gpt-4o', apiKey: 'test' },
                tools: [{ type: 'agent-spawner' }, { type: 'builtin-tools' }],
            } as unknown as AgentConfig;

            const agent = await createDextoAgentFromConfig({
                config,
                agentContext: 'subagent',
            });

            expect(loadImageMock).toHaveBeenCalledWith('@dexto/image-local');

            const enrichedConfig = enrichAgentConfigMock.mock.calls[0]?.[0] as {
                tools?: Array<Record<string, unknown>>;
            };
            expect(enrichedConfig.tools?.some((entry) => entry.type === 'agent-spawner')).toBe(
                false
            );

            const builtinTools = enrichedConfig.tools?.find(
                (entry) => entry.type === 'builtin-tools'
            );
            expect(builtinTools?.enabledTools).toEqual(['search_history']);

            expect(agent).toBeDefined();
        } finally {
            if (previousEnv === undefined) {
                delete process.env.DEXTO_IMAGE;
            } else {
                process.env.DEXTO_IMAGE = previousEnv;
            }
        }
    });

    it('drops builtin-tools entirely when filtering leaves no enabled tools', async () => {
        const { createDextoAgentFromConfig } = await import('./agent-creation.js');

        const config = {
            llm: { provider: 'openai', model: 'gpt-4o', apiKey: 'test' },
            tools: [{ type: 'builtin-tools', enabledTools: ['ask_user'] }],
        } as unknown as AgentConfig;

        await createDextoAgentFromConfig({
            config,
            agentContext: 'subagent',
        });

        const enrichedConfig = enrichAgentConfigMock.mock.calls.at(-1)?.[0] as {
            tools?: Array<Record<string, unknown>>;
        };

        expect(
            enrichedConfig.tools?.find((entry) => entry.type === 'builtin-tools')
        ).toBeUndefined();
    });
});
