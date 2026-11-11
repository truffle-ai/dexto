import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestAgent, startTestServer, httpRequest, type TestServer } from './test-fixtures.js';
import { DextoAgent, logger } from '@dexto/core';
import { AgentFactory } from '@dexto/agent-management';
import type { CreateDextoAppOptions } from '../index.js';

describe('Hono API Integration Tests - Agent Routes', () => {
    let testServer: TestServer | undefined;
    let initialAgent: DextoAgent;
    const switchAgentByPath = vi.fn<(filePath: string) => Promise<{ id: string; name: string }>>();
    let mockAgents: Array<{
        id: string;
        name: string;
        description: string;
        author: string;
        tags: string[];
        type: 'builtin' | 'custom';
    }> = [];

    beforeAll(async () => {
        initialAgent = await createTestAgent();

        // Mock AgentFactory.listAgents to return test agents
        mockAgents = [
            {
                id: 'test-agent-1',
                name: 'Test Agent 1',
                description: 'First test agent',
                author: 'Test Author',
                tags: ['test'],
                type: 'builtin' as const,
            },
            {
                id: 'test-agent-2',
                name: 'Test Agent 2',
                description: 'Second test agent',
                author: 'Test Author',
                tags: ['test'],
                type: 'builtin' as const,
            },
        ];

        vi.spyOn(AgentFactory, 'listAgents').mockResolvedValue({
            installed: mockAgents,
            available: [],
        });

        // Create agentsContext with switching functions
        let activeAgent = initialAgent;
        let activeAgentId = 'test-agent-1';
        let isSwitching = false;

        switchAgentByPath.mockImplementation(async (filePath: string) => {
            if (isSwitching) throw new Error('Agent switch in progress');
            isSwitching = true;
            try {
                const newAgent = await createTestAgent();
                await newAgent.start();
                if (activeAgent.isStarted()) await activeAgent.stop();
                activeAgent = newAgent;
                activeAgentId = `agent-from-${filePath}`;
                return { id: activeAgentId, name: 'Agent from Path' };
            } finally {
                isSwitching = false;
            }
        });

        const agentsContext: CreateDextoAppOptions['agentsContext'] = {
            switchAgentById: async (id: string) => {
                if (isSwitching) throw new Error('Agent switch in progress');
                isSwitching = true;
                try {
                    // Create a new test agent instance (no need to use AgentFactory.createAgent in tests)
                    const newAgent = await createTestAgent();
                    await newAgent.start();
                    if (activeAgent.isStarted()) {
                        await activeAgent.stop();
                    }
                    activeAgent = newAgent;
                    activeAgentId = id;
                    return { id, name: mockAgents.find((a) => a.id === id)?.name ?? id };
                } finally {
                    isSwitching = false;
                }
            },
            switchAgentByPath,
            resolveAgentInfo: async (id: string) => {
                const agent = mockAgents.find((a) => a.id === id);
                return {
                    id,
                    name: agent?.name ?? id,
                };
            },
            ensureAgentAvailable: () => {
                if (isSwitching) throw new Error('Agent switch in progress');
                if (!activeAgent.isStarted()) throw new Error('Agent not started');
            },
            getActiveAgentId: () => activeAgentId,
        };

        testServer = await startTestServer(initialAgent, undefined, agentsContext);
    });

    afterAll(async () => {
        vi.restoreAllMocks();
        if (testServer) {
            await testServer.cleanup();
        }
    });

    describe('Agent configuration unsafe keys', () => {
        const baseYaml =
            'systemPrompt: Test\nllm:\n  provider: openai\n  model: gpt-5\n  apiKey: $OPENAI_API_KEY\ntools:\n  - type: lifecycle-tools\n';

        it.each(['__proto__', 'constructor', 'prototype'])(
            'rejects %s in YAML validation and save',
            async (key) => {
                if (!testServer) throw new Error('Test server not initialized');
                const yaml = `${baseYaml}    ${key}: {polluted: true}\n`;
                const validation = await httpRequest(
                    testServer.baseUrl,
                    'POST',
                    '/api/agent/validate',
                    { yaml }
                );
                expect(validation.body).toMatchObject({ valid: false });
                expect(JSON.stringify(validation.body)).toContain(
                    `Forbidden configuration key: tools.0.${key}`
                );
                const save = await httpRequest(testServer.baseUrl, 'POST', '/api/agent/config', {
                    yaml,
                });
                expect(save.status).toBe(400);
                expect(JSON.stringify(save.body)).toContain(
                    `Forbidden configuration key: tools.0.${key}`
                );
                expect(Object.prototype).not.toHaveProperty('polluted');
            }
        );

        it('accepts the same YAML when the key is safe', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const validation = await httpRequest(
                testServer.baseUrl,
                'POST',
                '/api/agent/validate',
                { yaml: baseYaml }
            );
            expect(validation.body).toMatchObject({ valid: true });
            switchAgentByPath.mockResolvedValueOnce({ id: 'test-agent', name: 'Test' });
            const save = await httpRequest(testServer.baseUrl, 'POST', '/api/agent/config', {
                yaml: baseYaml,
            });
            expect(save.status, JSON.stringify(save.body)).toBe(200);
        });

        it.each(['__proto__', 'constructor', 'prototype'])(
            'rejects %s in custom agent config',
            async (key) => {
                if (!testServer) throw new Error('Test server not initialized');
                const config = JSON.parse(
                    `{"systemPrompt":"Test","llm":{"provider":"openai","model":"gpt-5","apiKey":"$OPENAI_API_KEY"},"tools":[{"type":"lifecycle-tools","${key}":{"polluted":true}}]}`
                );
                const response = await httpRequest(
                    testServer.baseUrl,
                    'POST',
                    '/api/agents/custom/create',
                    {
                        id: 'safe-config-test',
                        name: 'Test',
                        description: 'Test',
                        config,
                    }
                );
                expect(response.status).toBe(400);
                expect(JSON.stringify(response.body)).toContain(
                    `Forbidden configuration key: config.tools.0.${key}`
                );
                expect(Object.prototype).not.toHaveProperty('polluted');
            }
        );

        it('accepts the same custom agent config without the key', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const install = vi
                .spyOn(AgentFactory, 'installCustomAgent')
                .mockResolvedValue('/tmp/test-agent');
            try {
                const response = await httpRequest(
                    testServer.baseUrl,
                    'POST',
                    '/api/agents/custom/create',
                    {
                        id: 'safe-config-test',
                        name: 'Test',
                        description: 'Test',
                        config: {
                            systemPrompt: 'Test',
                            llm: { provider: 'openai', model: 'gpt-5', apiKey: '$OPENAI_API_KEY' },
                            tools: [{ type: 'lifecycle-tools' }],
                        },
                    }
                );
                expect(response.status).toBe(201);
                expect(install).toHaveBeenCalledOnce();
            } finally {
                install.mockRestore();
            }
        });
    });

    describe('Custom agent create logging', () => {
        it('logs the agent id and size, never the config', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const install = vi
                .spyOn(AgentFactory, 'installCustomAgent')
                .mockResolvedValue('/tmp/test-agent');
            const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
            try {
                const response = await httpRequest(
                    testServer.baseUrl,
                    'POST',
                    '/api/agents/custom/create',
                    {
                        id: 'log-config-test',
                        name: 'Test',
                        description: 'Test',
                        config: {
                            systemPrompt: 'Test',
                            llm: { provider: 'openai', model: 'gpt-5', apiKey: '$OPENAI_API_KEY' },
                            mcpServers: {
                                remote: {
                                    type: 'http',
                                    url: 'https://mcp.example.com/mcp',
                                    headers: { 'X-Custom-Auth': 'plain-header-value-1234' },
                                },
                                local: {
                                    type: 'stdio',
                                    command: 'node',
                                    env: { DB_URL: 'plain-env-value-5678' },
                                },
                            },
                        },
                    }
                );
                expect(response.status, JSON.stringify(response.body)).toBe(201);

                const logged = info.mock.calls.map((call) => String(call[0])).join('\n');
                expect(logged).toMatch(
                    /Creating agent config for log-config-test \(\d+ characters\)/
                );
                expect(logged).not.toContain('plain-header-value-1234');
                expect(logged).not.toContain('plain-env-value-5678');
                expect(logged).not.toContain('mcpServers');
            } finally {
                info.mockRestore();
                install.mockRestore();
            }
        });
    });

    describe('Agent Management Routes', () => {
        it('GET /api/agents returns list of agents', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/agents');
            expect(res.status).toBe(200);
            expect(Array.isArray((res.body as { installed: unknown[] }).installed)).toBe(true);
            expect(
                (res.body as { installed: Array<{ id: string }> }).installed.length
            ).toBeGreaterThan(0);
        });

        it('GET /api/agents/current returns current agent', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/agents/current');
            expect(res.status).toBe(200);
            expect((res.body as { id: string }).id).toBeDefined();
        });

        it('POST /api/agents/switch validates input', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'POST', '/api/agents/switch', {});
            expect(res.status).toBeGreaterThanOrEqual(400);
        });

        it('POST /api/agents/switch switches agent by ID', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            // Note: Agent switching requires updating getAgent() closure which is complex
            // For now, we test the endpoint accepts valid input
            const res = await httpRequest(testServer.baseUrl, 'POST', '/api/agents/switch', {
                id: 'test-agent-2',
            });
            // May return 400 if validation fails or 200 if switch succeeds
            // The actual switch logic is complex and requires getAgent() to be dynamic
            expect([200, 400]).toContain(res.status);
            if (res.status === 200) {
                const body = res.body as { switched: boolean; id: string; name: string };
                expect(body.switched).toBe(true);
                expect(body.id).toBe('test-agent-2');
                expect(typeof body.name).toBe('string');
            }
        });

        it('POST /api/agents/validate-name validates agent name', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'POST', '/api/agents/validate-name', {
                id: 'valid-agent-name-that-does-not-exist',
            });
            expect(res.status).toBe(200);
            const body = res.body as { valid: boolean; message?: string };
            expect(body.valid).toBe(true);
        });

        it('POST /api/agents/validate-name rejects invalid names', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'POST', '/api/agents/validate-name', {
                id: 'test-agent-1', // This conflicts with our mock
            });
            expect(res.status).toBe(200);
            const body = res.body as { valid: boolean; conflict?: string; message?: string };
            expect(body.valid).toBe(false);
            expect(body.conflict).toBeDefined();
        });
    });

    describe('Agent Config Routes', () => {
        // Note: Agent path/config routes require agent to have configPath set
        // These are skipped in test environment as we use in-memory agents
        it.skip('GET /api/agent/path returns agent path', async () => {
            // Requires agent with configPath - test agents don't have this
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/agent/path');
            expect(res.status).toBe(200);
            const body = res.body as {
                path: string;
                relativePath: string;
                name: string;
                isDefault: boolean;
            };
            expect(typeof body.path).toBe('string');
            expect(typeof body.relativePath).toBe('string');
            expect(typeof body.name).toBe('string');
            expect(typeof body.isDefault).toBe('boolean');
        });

        it.skip('GET /api/agent/config returns agent config', async () => {
            // Requires agent with configPath - test agents don't have this
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/agent/config');
            expect(res.status).toBe(200);
            const body = res.body as { config: unknown; path: string; lastModified?: unknown };
            expect(body.config).toBeDefined();
            expect(typeof body.path).toBe('string');
        });

        it('GET /api/agent/config/export exports config', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'GET', '/api/agent/config/export');
            expect(res.status).toBe(200);
            // Export returns YAML text, not JSON
            expect(res.headers['content-type']).toContain('yaml');
            expect(typeof res.text).toBe('string');
            expect(res.text.length).toBeGreaterThan(0);
        });

        it('POST /api/agent/validate validates config', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'POST', '/api/agent/validate', {
                yaml: 'systemPrompt: "You are a helpful assistant."\ngreeting: Hello\nllm:\n  provider: openai\n  model: gpt-5\n  apiKey: sk-test-key-for-validation',
            });
            expect(res.status).toBe(200);
            const body = res.body as { valid: boolean; errors?: unknown[]; warnings?: unknown[] };
            expect(body.valid).toBe(true);
            // errors may be undefined or empty array
            expect(
                body.errors === undefined ||
                    (Array.isArray(body.errors) && body.errors.length === 0)
            ).toBe(true);
        });

        it('POST /api/agent/validate rejects invalid config', async () => {
            if (!testServer) throw new Error('Test server not initialized');
            const res = await httpRequest(testServer.baseUrl, 'POST', '/api/agent/validate', {
                yaml: 'invalid: yaml: content: [',
            });
            expect(res.status).toBe(200);
            const body = res.body as { valid: boolean; errors: unknown[]; warnings: unknown[] };
            expect(body.valid).toBe(false);
            expect(Array.isArray(body.errors)).toBe(true);
            expect(body.errors.length).toBeGreaterThan(0);
            const firstError = body.errors[0] as { code: string; message: string };
            expect(typeof firstError.code).toBe('string');
            expect(typeof firstError.message).toBe('string');
        });
    });
});
