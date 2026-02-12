import { describe, expect, it } from 'vitest';
import { AgentConfigSchema } from '../schemas/agent-config.js';
import type { ResolvedServices } from './types.js';
import { toDextoAgentOptions } from './to-dexto-agent-options.js';
import {
    createMockBlobStore,
    createMockCache,
    createMockDatabase,
    createMockLogger,
    createMockTool,
} from './__fixtures__/test-mocks.js';

describe('toDextoAgentOptions', () => {
    it('combines validated config + resolved services into DextoAgentOptions', () => {
        const validated = AgentConfigSchema.parse({
            systemPrompt: 'You are a helpful assistant',
            llm: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                apiKey: 'test-key',
            },
            storage: {
                cache: { type: 'in-memory' },
                database: { type: 'in-memory' },
                blob: { type: 'in-memory' },
            },
            compaction: { type: 'noop', enabled: false },
        });

        const logger = createMockLogger();
        const services: ResolvedServices = {
            logger,
            storage: {
                blob: createMockBlobStore('in-memory'),
                database: createMockDatabase('in-memory'),
                cache: createMockCache('in-memory'),
            },
            tools: [createMockTool('foo')],
            plugins: [],
            compaction: null,
        };

        const options = toDextoAgentOptions({
            config: validated,
            services,
            overrides: {},
        });

        expect(options.agentId).toBe(validated.agentId);
        expect(options.llm).toBe(validated.llm);
        expect(options.systemPrompt).toBe(validated.systemPrompt);
        expect(options.mcpServers).toBe(validated.mcpServers);
        expect(options.sessions).toBe(validated.sessions);
        expect(options.toolConfirmation).toBe(validated.toolConfirmation);
        expect(options.elicitation).toBe(validated.elicitation);
        expect(options.internalResources).toBe(validated.internalResources);
        expect(options.prompts).toBe(validated.prompts);
        expect(options.overrides).toEqual({});

        expect(options.logger).toBe(logger);
        expect(options.storage.blob.getStoreType()).toBe('in-memory');
        expect(options.tools.map((t) => t.id)).toEqual(['foo']);
        expect(options.plugins).toEqual([]);
        expect(options.compaction).toBeNull();
    });
});
