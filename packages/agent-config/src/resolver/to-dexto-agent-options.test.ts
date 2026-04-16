import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type {
    DextoImage,
    DextoHostContext,
    ResolveImageRuntimeConfigOptions,
} from '../image/types.js';
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
    function createMockImage<THostContext extends DextoHostContext = DextoHostContext>(
        overrides?: Partial<DextoImage<THostContext>>
    ): DextoImage<THostContext> {
        const image: DextoImage<THostContext> = {
            metadata: { name: 'mock-image', version: '0.0.0', description: 'mock' },
            tools: {
                'noop-tools': {
                    configSchema: z.object({ type: z.literal('noop-tools') }).passthrough(),
                    create: () => [],
                },
            },
            storage: {
                blob: {
                    'in-memory': {
                        configSchema: z.any(),
                        create: () => createMockBlobStore('in-memory'),
                    },
                },
                database: {
                    'in-memory': {
                        configSchema: z.any(),
                        create: () => createMockDatabase('in-memory'),
                    },
                },
                cache: {
                    'in-memory': {
                        configSchema: z.any(),
                        create: () => createMockCache('in-memory'),
                    },
                },
            },
            hooks: {},
            compaction: {},
            logger: {
                configSchema: z.object({}).passthrough(),
                create: () => createMockLogger(),
            },
            ...(overrides ?? {}),
        };

        return image;
    }

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

        type HostedContext = DextoHostContext<
            { session: { id: string } },
            { workspace: boolean },
            { gateway: { id: string } }
        >;

        const hostContext: HostedContext = {
            mode: 'hosted',
            sessionId: 'session-1',
            workspaceId: 'workspace-1',
            runtime: {
                session: { id: 'session-1' },
            },
            capabilities: {
                workspace: true,
            },
            clients: {
                gateway: { id: 'gateway-1' },
            },
        };
        const resolveRuntimeConfig = vi.fn(
            ({ context }: ResolveImageRuntimeConfigOptions<HostedContext>) => {
                expect(context.hostContext?.runtime?.session.id).toBe('session-1');
                expect(context.hostContext?.capabilities?.workspace).toBe(true);
                expect(context.hostContext?.clients?.gateway.id).toBe('gateway-1');

                return {
                    llm: {
                        ...validated.llm,
                        apiKey: 'resolved-api-key',
                    },
                };
            }
        );
        const image = createMockImage<HostedContext>({
            resolveRuntimeConfig,
        });

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
