import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { AgentConfigSchema, type AgentConfig } from './agent-config.js';

describe('AgentConfigSchema', () => {
    const validAgentConfig: AgentConfig = {
        systemPrompt: 'You are a helpful assistant',
        llm: {
            provider: 'openai',
            model: 'gpt-4o-mini',
            apiKey: 'test-key',
        },
    };

    describe('Basic Structure Validation', () => {
        it('should accept valid minimal config', () => {
            const result = AgentConfigSchema.parse(validAgentConfig);

            expect(result.systemPrompt.contributors).toHaveLength(1);
            expect(result.llm.provider).toBe('openai');
            expect(result.llm.model).toBe('gpt-4o-mini');
            expect(result.llm.apiKey).toBe('test-key');
        });

        it('should apply default values', () => {
            const result = AgentConfigSchema.parse(validAgentConfig);

            expect(result.agentId).toBe('coding-agent');
            expect(result.agentFile.discoverInCwd).toBe(true);

            expect(result.mcpServers).toEqual({});
            expect(result.tools).toBeUndefined();

            expect(result.storage.cache.type).toBe('in-memory');
            expect(result.storage.database.type).toBe('in-memory');
            expect(result.storage.blob.type).toBe('in-memory');

            expect(result.sessions.maxSessions).toBe(100);
            expect(result.permissions.mode).toBe('auto-approve');
        });

        it('should preserve explicit values from composed schemas', () => {
            const config: AgentConfig = {
                agentCard: {
                    name: 'TestAgent',
                    description: 'Test agent for validation',
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
                tools: [{ type: 'builtin-tools', enabledTools: ['search_history'] }],
                llm: {
                    provider: 'anthropic',
                    model: 'claude-haiku-4-5-20251001',
                    apiKey: 'test-anthropic-key',
                    maxIterations: 25,
                },
                storage: {
                    cache: { type: 'redis', url: 'redis://localhost:6379' },
                    database: { type: 'postgres', url: 'postgresql://localhost:5432/test' },
                    blob: { type: 'local', storePath: '/tmp/test-blobs' },
                },
                sessions: {
                    maxSessions: 5,
                    sessionTTL: 1_800_000,
                },
                permissions: {
                    mode: 'auto-approve',
                    timeout: 15_000,
                },
            };

            const result = AgentConfigSchema.parse(config);

            expect(result.agentCard?.name).toBe('TestAgent');
            expect(result.systemPrompt.contributors[0]!.id).toBe('custom');
            expect(result.mcpServers.testServer).toBeDefined();
            expect(result.tools?.[0]?.type).toBe('builtin-tools');
            expect(result.llm.provider).toBe('anthropic');
            expect(result.storage.cache.type).toBe('redis');
            expect(result.sessions.maxSessions).toBe(5);
            expect(result.permissions.mode).toBe('auto-approve');
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
            expect(result.error?.issues[0]?.path[0]).toBe('llm');
        });
    });

    describe('Schema Composition Integration', () => {
        it('should transform systemPrompt from string to contributors object', () => {
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
    });

    describe('Strict Validation', () => {
        it('should reject unknown fields at the top level', () => {
            const config: any = {
                ...validAgentConfig,
                unknownField: 'should-fail',
            };

            const result = AgentConfigSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.unrecognized_keys);
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
                            source: 'date',
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
                },
                tools: [{ type: 'builtin-tools', enabledTools: ['search_history'] }],
                llm: {
                    provider: 'openai',
                    model: 'gpt-4o-mini',
                    apiKey: 'sk-prod-key-123',
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
                    blob: { type: 'local', storePath: '/tmp/test-blobs' },
                },
                sessions: {
                    maxSessions: 100,
                    sessionTTL: 7_200_000,
                },
                permissions: {
                    mode: 'manual',
                    timeout: 45_000,
                    allowedToolsStorage: 'storage',
                },
            };

            const result = AgentConfigSchema.parse(prodConfig);

            expect(result.agentCard?.name).toBe('Production Agent');
            expect(result.systemPrompt.contributors).toHaveLength(2);
            expect(Object.keys(result.mcpServers)).toHaveLength(1);
            expect(result.tools?.[0]?.type).toBe('builtin-tools');
            expect(result.llm.temperature).toBe(0.3);
            expect(result.storage.cache.type).toBe('redis');
            expect(result.sessions.maxSessions).toBe(100);
            expect(result.permissions.timeout).toBe(45_000);
        });
    });
});
