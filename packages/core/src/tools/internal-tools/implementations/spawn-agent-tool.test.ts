import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createSpawnAgentTool } from './spawn-agent-tool.js';
import type { DextoAgent } from '../../../agent/DextoAgent.js';
import type { AgentConfigProvider } from '../../../agent/types.js';
import type { AgentConfig } from '../../../agent/schemas.js';

describe('spawn-agent tool', () => {
    let mockAgent: any;
    let mockAgentConfigProvider: AgentConfigProvider;
    let spawnAgentTool: any;

    const mockAgentConfig: AgentConfig = {
        agentId: 'test-agent',
        systemPrompt: {
            contributors: [
                {
                    id: 'primary',
                    type: 'static',
                    priority: 0,
                    content: 'Test prompt',
                },
            ],
        },
        llm: {
            provider: 'anthropic',
            model: 'claude-haiku-4-5-20251001',
            apiKey: 'test-api-key',
        },
        storage: {
            database: { type: 'sqlite', path: ':memory:' },
            cache: { type: 'in-memory' },
            blob: { type: 'in-memory' },
        },
    };

    beforeEach(() => {
        mockAgent = {
            handoff: vi.fn().mockResolvedValue({
                result: 'Task completed successfully',
                duration: 1500,
                tokenUsage: {
                    inputTokens: 100,
                    outputTokens: 50,
                    totalTokens: 150,
                },
            }),
        } as any;

        mockAgentConfigProvider = {
            resolveAgentConfig: vi.fn().mockResolvedValue(mockAgentConfig),
        };

        spawnAgentTool = createSpawnAgentTool(mockAgent, mockAgentConfigProvider);
    });

    describe('input schema validation', () => {
        test('should accept valid input', () => {
            const validInput = {
                agent: 'general-purpose',
                prompt: 'Analyze the authentication code',
                description: 'Auth analysis',
            };

            const result = spawnAgentTool.inputSchema.safeParse(validInput);
            expect(result.success).toBe(true);
        });

        test('should accept input without description', () => {
            const validInput = {
                agent: 'code-reviewer',
                prompt: 'Review the API endpoints',
            };

            const result = spawnAgentTool.inputSchema.safeParse(validInput);
            expect(result.success).toBe(true);
        });

        test('should reject input without agent', () => {
            const invalidInput = {
                prompt: 'Do something',
            };

            const result = spawnAgentTool.inputSchema.safeParse(invalidInput);
            expect(result.success).toBe(false);
        });

        test('should reject input without prompt', () => {
            const invalidInput = {
                agent: 'general-purpose',
            };

            const result = spawnAgentTool.inputSchema.safeParse(invalidInput);
            expect(result.success).toBe(false);
        });

        test('should reject empty prompt', () => {
            const invalidInput = {
                agent: 'general-purpose',
                prompt: '',
            };

            const result = spawnAgentTool.inputSchema.safeParse(invalidInput);
            expect(result.success).toBe(false);
        });

        test('should reject unknown properties', () => {
            const invalidInput = {
                agent: 'general-purpose',
                prompt: 'Test',
                unknownField: 'value',
            };

            const result = spawnAgentTool.inputSchema.safeParse(invalidInput);
            expect(result.success).toBe(false);
        });
    });

    describe('execute()', () => {
        test('should execute spawn with valid input', async () => {
            const input = {
                agent: 'general-purpose',
                prompt: 'Analyze the code',
                description: 'Code analysis',
            };

            const context = {
                sessionId: 'test-session-id',
            };

            const result = await spawnAgentTool.execute(input, context);

            expect(result).toMatchObject({
                result: 'Task completed successfully',
                duration: 1500,
                agent: 'general-purpose',
            });

            expect(mockAgentConfigProvider.resolveAgentConfig).toHaveBeenCalledWith(
                'general-purpose'
            );
            expect(mockAgent.handoff).toHaveBeenCalledWith('Analyze the code', {
                agent: mockAgentConfig,
                description: 'Code analysis',
                parentSessionId: 'test-session-id',
            });
        });

        test('should execute without description', async () => {
            const input = {
                agent: 'code-reviewer',
                prompt: 'Review security',
            };

            const context = {
                sessionId: 'test-session-id',
            };

            await spawnAgentTool.execute(input, context);

            expect(mockAgent.handoff).toHaveBeenCalledWith('Review security', {
                agent: mockAgentConfig,
                parentSessionId: 'test-session-id',
            });
        });

        test('should throw if sessionId not provided', async () => {
            const input = {
                agent: 'general-purpose',
                prompt: 'Test',
            };

            await expect(spawnAgentTool.execute(input, {})).rejects.toThrow(
                'Session context is required'
            );
        });

        test('should throw if agent config provider fails', async () => {
            mockAgentConfigProvider.resolveAgentConfig = vi
                .fn()
                .mockRejectedValue(new Error('Agent not found'));

            const input = {
                agent: 'unknown-agent',
                prompt: 'Test',
            };

            const context = {
                sessionId: 'test-session-id',
            };

            await expect(spawnAgentTool.execute(input, context)).rejects.toThrow(
                'Failed to resolve agent "unknown-agent"'
            );
        });

        test('should include error in result if handoff fails', async () => {
            mockAgent.handoff.mockResolvedValue({
                result: '',
                duration: 500,
                error: 'Sub-agent failed to complete task',
            });

            const input = {
                agent: 'general-purpose',
                prompt: 'Test',
            };

            const context = {
                sessionId: 'test-session-id',
            };

            const result = await spawnAgentTool.execute(input, context);

            expect(result).toHaveProperty('error', 'Sub-agent failed to complete task');
        });

        test('should handle different agent identifiers', async () => {
            const testCases = [
                'general-purpose',
                'code-reviewer',
                './custom-agent.yml',
                'my-custom-agent',
            ];

            for (const agentId of testCases) {
                vi.clearAllMocks();

                const input = {
                    agent: agentId,
                    prompt: 'Test',
                };

                const context = {
                    sessionId: 'test-session-id',
                };

                await spawnAgentTool.execute(input, context);

                expect(mockAgentConfigProvider.resolveAgentConfig).toHaveBeenCalledWith(agentId);
            }
        });
    });

    describe('tool metadata', () => {
        test('should have correct id', () => {
            expect(spawnAgentTool.id).toBe('spawn_agent');
        });

        test('should have description', () => {
            expect(spawnAgentTool.description).toBeDefined();
            expect(spawnAgentTool.description.length).toBeGreaterThan(0);
        });

        test('should mention common built-in agents in description', () => {
            expect(spawnAgentTool.description).toContain('general-purpose');
            expect(spawnAgentTool.description).toContain('code-reviewer');
        });

        test('should have usage example in description', () => {
            expect(spawnAgentTool.description).toContain('spawn_agent(');
            expect(spawnAgentTool.description).toContain('agent:');
            expect(spawnAgentTool.description).toContain('prompt:');
        });
    });
});
