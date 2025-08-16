import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
    AgentCardSchema,
    AgentConfigSchema,
    type AgentCard,
    type ValidatedAgentCard,
    type AgentConfig,
    type ValidatedAgentConfig,
} from './schemas.js';

describe('AgentCardSchema', () => {
    const validAgentCard: AgentCard = {
        name: 'TestAgent',
        url: 'https://agent.example.com',
        version: '1.0.0',
    };

    describe('Basic Structure Validation', () => {
        it('should accept valid minimal config', () => {
            const result = AgentCardSchema.parse(validAgentCard);

            expect(result.name).toBe('TestAgent');
            expect(result.url).toBe('https://agent.example.com');
            expect(result.version).toBe('1.0.0');
        });

        it('should apply default values', () => {
            const result = AgentCardSchema.parse(validAgentCard);

            expect(result.description).toBe(
                'Dexto is an AI assistant capable of chat and task delegation, accessible via multiple protocols.'
            );
            expect(result.capabilities.streaming).toBe(true);
            expect(result.capabilities.stateTransitionHistory).toBe(false);
            expect(result.authentication.schemes).toEqual([]);
            expect(result.defaultInputModes).toEqual(['application/json', 'text/plain']);
            expect(result.defaultOutputModes).toEqual([
                'application/json',
                'text/event-stream',
                'text/plain',
            ]);
            expect(result.skills).toHaveLength(1);
            expect(result.skills[0]!.id).toBe('chat_with_agent');
        });

        it('should preserve explicit values', () => {
            const config: AgentCard = {
                ...validAgentCard,
                description: 'Custom description',
                capabilities: {
                    streaming: false,
                    pushNotifications: true,
                    stateTransitionHistory: true,
                },
                authentication: {
                    schemes: ['bearer', 'api-key'],
                    credentials: 'optional-creds',
                },
                defaultInputModes: ['text/plain'],
                defaultOutputModes: ['application/json'],
                skills: [
                    {
                        id: 'custom-skill',
                        name: 'Custom Skill',
                        description: 'A custom skill',
                        tags: ['custom'],
                        inputModes: ['application/json'],
                        outputModes: ['text/plain'],
                    },
                ],
            };

            const result = AgentCardSchema.parse(config);

            expect(result.description).toBe('Custom description');
            expect(result.capabilities.streaming).toBe(false);
            expect(result.capabilities.pushNotifications).toBe(true);
            expect(result.capabilities.stateTransitionHistory).toBe(true);
            expect(result.authentication.schemes).toEqual(['bearer', 'api-key']);
            expect(result.authentication.credentials).toBe('optional-creds');
            expect(result.defaultInputModes).toEqual(['text/plain']);
            expect(result.defaultOutputModes).toEqual(['application/json']);
            expect(result.skills).toHaveLength(1);
            expect(result.skills[0]!.id).toBe('custom-skill');
        });
    });

    describe('Required Fields Validation', () => {
        it('should require name field', () => {
            const config = { ...validAgentCard };
            delete (config as any).name;

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['name']);
        });

        it('should require url field', () => {
            const config = { ...validAgentCard };
            delete (config as any).url;

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['url']);
        });

        it('should require version field', () => {
            const config = { ...validAgentCard };
            delete (config as any).version;

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['version']);
        });
    });

    describe('URL Validation', () => {
        it('should accept valid URLs', () => {
            const validUrls = [
                'https://example.com',
                'http://localhost:8080',
                'https://agent.company.com/v1',
            ];

            for (const url of validUrls) {
                const config = { ...validAgentCard, url };
                const result = AgentCardSchema.safeParse(config);
                expect(result.success).toBe(true);
            }
        });

        it('should reject invalid URLs', () => {
            const invalidUrls = ['not-a-url', 'just-text', ''];

            for (const url of invalidUrls) {
                const config = { ...validAgentCard, url };
                const result = AgentCardSchema.safeParse(config);
                expect(result.success).toBe(false);
            }
        });

        it('should validate provider.url when provider is specified', () => {
            const config: AgentCard = {
                ...validAgentCard,
                provider: {
                    organization: 'Test Corp',
                    url: 'invalid-url',
                },
            };

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['provider', 'url']);
        });

        it('should validate documentationUrl when specified', () => {
            const config: AgentCard = {
                ...validAgentCard,
                documentationUrl: 'not-a-url',
            };

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['documentationUrl']);
        });
    });

    describe('Skills Validation', () => {
        it('should validate skill structure', () => {
            const config: AgentCard = {
                ...validAgentCard,
                skills: [
                    {
                        id: 'test-skill',
                        name: 'Test Skill',
                        description: 'A test skill',
                        tags: ['test', 'demo'],
                    },
                ],
            };

            const result = AgentCardSchema.parse(config);
            expect(result.skills[0]!.inputModes).toEqual(['text/plain']); // default
            expect(result.skills[0]!.outputModes).toEqual(['text/plain']); // default
        });

        it('should require skill fields', () => {
            const config: AgentCard = {
                ...validAgentCard,
                skills: [
                    {
                        id: 'test-skill',
                        name: 'Test Skill',
                        // Missing description and tags
                    } as any,
                ],
            };

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
        });
    });

    describe('Strict Validation', () => {
        it('should reject unknown fields', () => {
            const config: any = {
                ...validAgentCard,
                unknownField: 'should-fail',
            };

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.unrecognized_keys);
        });

        it('should reject unknown fields in nested objects', () => {
            const config: any = {
                ...validAgentCard,
                capabilities: {
                    streaming: true,
                    unknownCapability: true,
                },
            };

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.unrecognized_keys);
        });
    });

    describe('Type Safety', () => {
        it('should handle input and output types correctly', () => {
            const input: AgentCard = validAgentCard;
            const result: ValidatedAgentCard = AgentCardSchema.parse(input);

            // Should have applied defaults
            expect(result.description).toBeTruthy();
            expect(result.capabilities).toBeDefined();
            expect(result.authentication).toBeDefined();

            // Should preserve input values
            expect(result.name).toBe(input.name);
            expect(result.url).toBe(input.url);
            expect(result.version).toBe(input.version);
        });
    });
});

describe('AgentConfigSchema', () => {
    const validAgentConfig: AgentConfig = {
        systemPrompt: 'You are a helpful assistant',
        llm: {
            provider: 'openai',
            model: 'gpt-4o',
            apiKey: 'test-key',
        },
    };

    describe('Basic Structure Validation', () => {
        it('should accept valid minimal config', () => {
            const result = AgentConfigSchema.parse(validAgentConfig);

            expect(result.systemPrompt.contributors).toHaveLength(1);
            expect(result.llm.provider).toBe('openai');
            expect(result.llm.model).toBe('gpt-4o');
            expect(result.llm.apiKey).toBe('test-key');
        });

        it('should apply default values', () => {
            const result = AgentConfigSchema.parse(validAgentConfig);

            // Should apply defaults from composed schemas
            expect(result.mcpServers).toEqual({});
            expect(result.internalTools).toEqual([]);
            expect(result.storage.cache.type).toBe('in-memory');
            expect(result.storage.database.type).toBe('in-memory');
            expect(result.sessions).toBeDefined();
            expect(result.toolConfirmation).toBeDefined();
        });

        it('should preserve explicit values from all composed schemas', () => {
            const config: AgentConfig = {
                agentCard: {
                    name: 'TestAgent',
                    url: 'https://agent.example.com',
                    version: '1.0.0',
                },
                systemPrompt: {
                    contributors: [
                        {
                            id: 'custom',
                            type: 'static',
                            content: 'Custom prompt',
                            priority: 0,
                        },
                    ],
                },
                mcpServers: {
                    testServer: {
                        type: 'stdio',
                        command: 'node',
                        args: ['server.js'],
                    },
                },
                internalTools: ['search_history'],
                llm: {
                    provider: 'anthropic',
                    model: 'claude-3-haiku-20240307',
                    apiKey: 'test-anthropic-key',
                    router: 'in-built',
                    maxIterations: 25,
                },
                storage: {
                    cache: { type: 'redis', url: 'redis://localhost:6379' },
                    database: { type: 'postgres', url: 'postgresql://localhost:5432/test' },
                },
                sessions: {
                    maxSessions: 5,
                    sessionTTL: 1800,
                },
                toolConfirmation: {
                    mode: 'auto-approve',
                    timeout: 15000,
                },
            };

            const result = AgentConfigSchema.parse(config);

            expect(result.agentCard?.name).toBe('TestAgent');
            expect(result.systemPrompt.contributors[0]!.id).toBe('custom');
            expect(result.mcpServers.testServer).toBeDefined();
            expect(result.internalTools).toEqual(['search_history']);
            expect(result.llm.provider).toBe('anthropic');
            expect(result.llm.router).toBe('in-built');
            expect(result.storage.cache.type).toBe('redis');
            expect(result.sessions.maxSessions).toBe(5);
            expect(result.toolConfirmation.mode).toBe('auto-approve');
        });
    });

    describe('Required Fields Validation', () => {
        it('should require systemPrompt field', () => {
            const config = { ...validAgentConfig };
            delete (config as any).systemPrompt;

            const result = AgentConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['systemPrompt']);
        });

        it('should require llm field', () => {
            const config = { ...validAgentConfig };
            delete (config as any).llm;

            const result = AgentConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['llm']);
        });
    });

    describe('Validation Propagation', () => {
        it('should propagate validation errors from nested schemas', () => {
            // Test that validation failures in composed schemas bubble up correctly
            // Detailed validation testing is done in individual schema test files
            const configWithInvalidLLM: AgentConfig = {
                ...validAgentConfig,
                llm: {
                    provider: 'invalid-provider' as any,
                    model: 'test-model',
                    apiKey: 'test-key',
                },
            };

            const result = AgentConfigSchema.safeParse(configWithInvalidLLM);
            expect(result.success).toBe(false);
            // Verify error path points to the nested schema field
            expect(result.error?.issues[0]?.path[0]).toBe('llm');
        });
    });

    describe('Schema Composition Integration', () => {
        it('should properly transform systemPrompt from string to object', () => {
            const config: AgentConfig = {
                ...validAgentConfig,
                systemPrompt: 'Simple string prompt',
            };

            const result = AgentConfigSchema.parse(config);

            expect(result.systemPrompt.contributors).toHaveLength(1);
            expect(result.systemPrompt.contributors[0]!.type).toBe('static');
            expect((result.systemPrompt.contributors[0] as any).content).toBe(
                'Simple string prompt'
            );
        });

        it('should apply defaults from all composed schemas', () => {
            const result = AgentConfigSchema.parse(validAgentConfig);

            // Defaults from different schemas should all be applied
            expect(result.llm.maxIterations).toBe(50); // LLM schema default
            expect(result.llm.router).toBe('vercel'); // LLM schema default
            expect(result.storage.cache.type).toBe('in-memory'); // Storage schema default
            expect(result.sessions.maxSessions).toBe(100); // Session schema default
            expect(result.toolConfirmation.mode).toBe('event-based'); // Tool schema default
        });
    });

    describe('Strict Validation', () => {
        it('should reject unknown fields', () => {
            const config: any = {
                ...validAgentConfig,
                unknownField: 'should-fail',
            };

            const result = AgentConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.unrecognized_keys);
        });
    });

    describe('Type Safety', () => {
        it('should handle input and output types correctly', () => {
            const input: AgentConfig = validAgentConfig;
            const result: ValidatedAgentConfig = AgentConfigSchema.parse(input);

            // Should have applied defaults from all composed schemas
            expect(result.mcpServers).toBeDefined();
            expect(result.internalTools).toBeDefined();
            expect(result.storage).toBeDefined();
            expect(result.sessions).toBeDefined();
            expect(result.toolConfirmation).toBeDefined();

            // Should preserve input values
            expect(result.llm.provider).toBe(input.llm.provider);
            expect(result.llm.model).toBe(input.llm.model);
            expect(result.llm.apiKey).toBe(input.llm.apiKey);
        });

        it('should maintain proper types for nested objects', () => {
            const config = AgentConfigSchema.parse(validAgentConfig);

            // TypeScript should infer correct nested types
            expect(typeof config.llm.provider).toBe('string');
            expect(typeof config.llm.model).toBe('string');
            expect(typeof config.storage.cache.type).toBe('string');
            expect(Array.isArray(config.internalTools)).toBe(true);
            expect(typeof config.sessions.maxSessions).toBe('number');
        });
    });

    describe('Real-world Scenarios', () => {
        it('should handle complete production config', () => {
            const prodConfig: AgentConfig = {
                agentCard: {
                    name: 'Production Agent',
                    description: 'Production AI agent for customer support',
                    url: 'https://api.company.com/agent',
                    version: '2.1.0',
                    provider: {
                        organization: 'ACME Corp',
                        url: 'https://acme.com',
                    },
                    documentationUrl: 'https://docs.acme.com/agent',
                },
                systemPrompt: {
                    contributors: [
                        {
                            id: 'main',
                            type: 'static',
                            content: 'You are a customer support agent.',
                            priority: 0,
                        },
                        {
                            id: 'datetime',
                            type: 'dynamic',
                            source: 'dateTime',
                            priority: 10,
                        },
                    ],
                },
                mcpServers: {
                    database: {
                        type: 'stdio',
                        command: 'python',
                        args: ['-m', 'db_server'],
                        env: { DB_URL: 'postgresql://prod:5432/db' },
                    },
                    search: {
                        type: 'http',
                        url: 'https://search.company.com/mcp',
                        headers: { Authorization: 'Bearer prod-token' },
                    },
                },
                internalTools: ['search_history'],
                llm: {
                    provider: 'openai',
                    model: 'gpt-4o',
                    apiKey: 'sk-prod-key-123',
                    router: 'vercel',
                    maxIterations: 30,
                    temperature: 0.3,
                },
                storage: {
                    cache: {
                        type: 'redis',
                        url: 'redis://cache.company.com:6379',
                    },
                    database: {
                        type: 'postgres',
                        url: 'postgresql://db.company.com:5432/agent_db',
                    },
                },
                sessions: {
                    maxSessions: 100,
                    sessionTTL: 7200,
                },
                toolConfirmation: {
                    mode: 'event-based',
                    timeout: 45000,
                    allowedToolsStorage: 'storage',
                },
            };

            const result = AgentConfigSchema.parse(prodConfig);

            expect(result.agentCard?.name).toBe('Production Agent');
            expect(result.systemPrompt.contributors).toHaveLength(2);
            expect(Object.keys(result.mcpServers)).toHaveLength(2);
            expect(result.internalTools).toEqual(['search_history']);
            expect(result.llm.temperature).toBe(0.3);
            expect(result.storage.cache.type).toBe('redis');
            expect(result.sessions.maxSessions).toBe(100);
            expect(result.toolConfirmation.timeout).toBe(45000);
        });

        it('should handle minimal config with all defaults', () => {
            const minimalConfig: AgentConfig = {
                systemPrompt: 'You are helpful',
                llm: {
                    provider: 'openai',
                    model: 'gpt-4o-mini',
                    apiKey: 'sk-test',
                },
            };

            const result = AgentConfigSchema.parse(minimalConfig);

            // Should have all defaults applied
            expect(result.mcpServers).toEqual({});
            expect(result.internalTools).toEqual([]);
            expect(result.storage.cache.type).toBe('in-memory');
            expect(result.storage.database.type).toBe('in-memory');
            expect(result.sessions).toBeDefined();
            expect(result.toolConfirmation.mode).toBe('event-based');
            expect(result.llm.maxIterations).toBe(50);
            expect(result.llm.router).toBe('vercel');
        });
    });
});
