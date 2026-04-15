import { describe, expect, it, vi } from 'vitest';
import type { DextoImage, DextoHostContext } from '../image/types.js';
import { AgentConfigSchema } from '../schemas/agent-config.js';
import type { ResolvedServices } from './types.js';
import { toDextoAgentOptions } from './to-dexto-agent-options.js';
import validImage from './__fixtures__/valid-image.js';
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
            toolkitLoader: async () => [],
            hooks: [],
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
        expect(options.permissions).toBe(validated.permissions);
        expect(options.elicitation).toBe(validated.elicitation);
        expect(options.resources).toBe(validated.resources);
        expect(options.prompts).toBe(validated.prompts);
        expect(options.overrides).toEqual({});

        expect(options.logger).toBe(logger);
        expect(options.storage.blob.getStoreType()).toBe('in-memory');
        expect((options.tools ?? []).map((t) => t.id)).toEqual(['foo']);
        expect(options.hooks).toEqual([]);
        expect(options.compaction).toBeNull();
        expect(options.toolkitLoader).toBe(services.toolkitLoader);
    });

    it('applies runtime overrides outside the validated agent config', () => {
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
            toolkitLoader: async () => [],
            hooks: [],
            compaction: null,
        };

        const options = toDextoAgentOptions({
            config: validated,
            services,
            runtimeOverrides: { usageScopeId: 'cloud-agent-1' },
        });

        expect(options.usageScopeId).toBe('cloud-agent-1');
    });

    it('applies image runtime overrides resolved from host context', () => {
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
            toolkitLoader: async () => [],
            hooks: [],
            compaction: null,
        };

        const hostContext: DextoHostContext = {
            mode: 'hosted',
            sessionId: 'session-1',
            workspaceId: 'workspace-1',
        };
        const resolveRuntimeConfig = vi.fn(() => ({
            llm: {
                ...validated.llm,
                apiKey: 'resolved-api-key',
            },
        }));
        const image = {
            ...validImage,
            resolveRuntimeConfig,
        } as unknown as DextoImage;

        const options = toDextoAgentOptions({
            config: validated,
            services,
            image,
            hostContext,
        });

        expect(resolveRuntimeConfig).toHaveBeenCalledWith({
            config: validated,
            context: {
                agentId: validated.agentId,
                hostContext,
            },
        });
        expect(options.llm.apiKey).toBe('resolved-api-key');
    });
});
