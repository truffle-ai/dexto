import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInvokeSkillTool } from './invoke-skill-tool.js';
import type { PromptManager } from '../../../prompts/prompt-manager.js';
import type { InternalToolsServices, TaskForker } from '../registry.js';

describe('invoke_skill tool', () => {
    let tool: ReturnType<typeof createInvokeSkillTool>;
    let mockPromptManager: Partial<PromptManager>;
    let services: InternalToolsServices;

    const mockAutoInvocablePrompts = {
        'config:plugin:skill-one': {
            name: 'config:plugin:skill-one',
            displayName: 'plugin:skill-one',
            description: 'First skill',
        },
        'config:simple-skill': {
            name: 'config:simple-skill',
            displayName: 'simple-skill',
            description: 'Simple skill without namespace',
        },
    };

    beforeEach(() => {
        mockPromptManager = {
            listAutoInvocablePrompts: vi.fn().mockResolvedValue(mockAutoInvocablePrompts),
            // GetPromptResult structure: { messages: [{ content: { type: 'text', text: '...' } }] }
            getPrompt: vi.fn().mockResolvedValue({
                messages: [{ content: { type: 'text', text: 'Skill instructions here' } }],
            }),
            // Return undefined for context (inline execution is default)
            getPromptDefinition: vi.fn().mockResolvedValue(undefined),
        };

        services = { promptManager: mockPromptManager as PromptManager };
        tool = createInvokeSkillTool(services);
    });

    describe('Tool Definition', () => {
        it('should have correct tool metadata', () => {
            expect(tool.id).toBe('invoke_skill');
            expect(tool.description).toBeDefined();
            expect(tool.description.length).toBeGreaterThan(0);
            expect(tool.inputSchema).toBeDefined();
        });

        it('should have required input schema fields', () => {
            const schema = tool.inputSchema as any;
            expect(schema.shape.skill).toBeDefined();
            expect(schema.shape.args).toBeDefined();
        });

        it('should have helpful description', () => {
            expect(tool.description).toContain('skill');
            expect(tool.description).toContain('instructions');
        });
    });

    describe('Input Validation', () => {
        it('should accept valid input with just skill name', () => {
            const validInput = {
                skill: 'skill-one',
            };

            const result = tool.inputSchema.safeParse(validInput);
            expect(result.success).toBe(true);
        });

        it('should accept valid input with skill name and args', () => {
            const validInput = {
                skill: 'skill-one',
                args: { key: 'value' },
            };

            const result = tool.inputSchema.safeParse(validInput);
            expect(result.success).toBe(true);
        });

        it('should accept valid input with taskContext', () => {
            const validInput = {
                skill: 'skill-one',
                taskContext: 'User wants to accomplish X',
            };

            const result = tool.inputSchema.safeParse(validInput);
            expect(result.success).toBe(true);
        });

        it('should reject empty skill name', () => {
            const invalidInput = {
                skill: '',
            };

            const result = tool.inputSchema.safeParse(invalidInput);
            expect(result.success).toBe(false);
        });

        it('should reject missing skill name', () => {
            const invalidInput = {};

            const result = tool.inputSchema.safeParse(invalidInput);
            expect(result.success).toBe(false);
        });
    });

    describe('Skill Lookup', () => {
        it('should find skill by full key', async () => {
            const result = (await tool.execute({
                skill: 'config:plugin:skill-one',
            })) as any;

            expect(result.skill).toBe('config:plugin:skill-one');
            expect(result.content).toContain('Skill instructions here');
            expect(mockPromptManager.getPrompt).toHaveBeenCalledWith(
                'config:plugin:skill-one',
                undefined
            );
        });

        it('should find skill by displayName', async () => {
            const result = (await tool.execute({
                skill: 'plugin:skill-one',
            })) as any;

            expect(result.skill).toBe('config:plugin:skill-one');
            expect(result.content).toContain('Skill instructions here');
        });

        it('should find skill by name', async () => {
            const result = (await tool.execute({
                skill: 'simple-skill',
            })) as any;

            // Should match config:simple-skill by checking `info.name === 'config:${skill}'`
            expect(result.skill).toBe('config:simple-skill');
        });

        it('should pass args to getPrompt', async () => {
            const args = { format: 'json', verbose: 'true' };

            await tool.execute({
                skill: 'plugin:skill-one',
                args,
            });

            expect(mockPromptManager.getPrompt).toHaveBeenCalledWith(
                'config:plugin:skill-one',
                args
            );
        });
    });

    describe('Error Handling', () => {
        it('should return error for unknown skill', async () => {
            const result = (await tool.execute({
                skill: 'nonexistent-skill',
            })) as any;

            expect(result.error).toBeDefined();
            expect(result.error).toContain('not found');
            expect(result.availableSkills).toEqual([
                'config:plugin:skill-one',
                'config:simple-skill',
            ]);
        });

        it('should include available skills in error response', async () => {
            const result = (await tool.execute({
                skill: 'unknown',
            })) as any;

            expect(result.availableSkills).toBeDefined();
            expect(Array.isArray(result.availableSkills)).toBe(true);
            expect(result.availableSkills.length).toBe(2);
        });
    });

    describe('Successful Invocation', () => {
        it('should return skill content and instructions', async () => {
            const result = (await tool.execute({
                skill: 'simple-skill',
            })) as any;

            expect(result.skill).toBeDefined();
            expect(result.content).toBeDefined();
            expect(result.instructions).toBeDefined();
            expect(result.instructions).toContain('Follow the instructions');
        });

        it('should handle array of prompt content', async () => {
            mockPromptManager.getPrompt = vi.fn().mockResolvedValue({
                messages: [
                    { content: { type: 'text', text: 'Part 1' } },
                    { content: { type: 'text', text: 'Part 2' } },
                ],
            });

            const result = (await tool.execute({
                skill: 'simple-skill',
            })) as any;

            expect(result.content).toContain('Part 1');
            expect(result.content).toContain('Part 2');
        });
    });

    describe('Empty Skills List', () => {
        it('should handle when no skills are available', async () => {
            mockPromptManager.listAutoInvocablePrompts = vi.fn().mockResolvedValue({});

            const result = (await tool.execute({
                skill: 'any-skill',
            })) as any;

            expect(result.error).toContain('not found');
            expect(result.availableSkills).toEqual([]);
        });
    });

    describe('Context: Fork Execution', () => {
        // Fork skills call taskForker.fork() directly - no additional tool calls needed
        let mockTaskForker: TaskForker;

        beforeEach(() => {
            mockTaskForker = {
                fork: vi.fn().mockResolvedValue({
                    success: true,
                    response: 'Forked task completed successfully',
                }),
            };
        });

        it('should execute fork via taskForker when context is fork', async () => {
            mockPromptManager.getPromptDefinition = vi.fn().mockResolvedValue({
                context: 'fork',
            });
            services.taskForker = mockTaskForker;

            const result = await tool.execute({
                skill: 'simple-skill',
            });

            // Fork skills return just the result text (not JSON)
            expect(result).toBe('Forked task completed successfully');
            expect(mockTaskForker.fork).toHaveBeenCalledWith(
                expect.objectContaining({
                    task: 'Skill: simple-skill',
                    instructions: 'Skill instructions here',
                })
            );
        });

        it('should include taskContext in forked instructions', async () => {
            mockPromptManager.getPromptDefinition = vi.fn().mockResolvedValue({
                context: 'fork',
            });
            services.taskForker = mockTaskForker;

            await tool.execute({
                skill: 'simple-skill',
                taskContext: 'User wants to analyze code quality',
            });

            expect(mockTaskForker.fork).toHaveBeenCalledWith(
                expect.objectContaining({
                    instructions: expect.stringContaining('## Task Context'),
                })
            );
            expect(mockTaskForker.fork).toHaveBeenCalledWith(
                expect.objectContaining({
                    instructions: expect.stringContaining('User wants to analyze code quality'),
                })
            );
        });

        it('should pass agentId from skill definition to fork', async () => {
            mockPromptManager.getPromptDefinition = vi.fn().mockResolvedValue({
                context: 'fork',
                agent: 'explore-agent',
            });
            services.taskForker = mockTaskForker;

            await tool.execute({
                skill: 'simple-skill',
            });

            expect(mockTaskForker.fork).toHaveBeenCalledWith(
                expect.objectContaining({
                    agentId: 'explore-agent',
                })
            );
        });

        it('should return error when fork required but taskForker not available', async () => {
            mockPromptManager.getPromptDefinition = vi.fn().mockResolvedValue({
                context: 'fork',
            });
            // Don't set taskForker on services

            const result = (await tool.execute({
                skill: 'simple-skill',
            })) as any;

            expect(result.error).toContain('requires fork execution');
            expect(result.error).toContain('agent spawning is not available');
        });

        it('should handle fork execution failure', async () => {
            mockPromptManager.getPromptDefinition = vi.fn().mockResolvedValue({
                context: 'fork',
            });
            services.taskForker = {
                fork: vi.fn().mockResolvedValue({
                    success: false,
                    error: 'Subagent timed out',
                }),
            };

            const result = await tool.execute({
                skill: 'simple-skill',
            });

            // Fork errors return error message as text
            expect(result).toBe('Error: Subagent timed out');
        });

        it('should use inline execution when context is inline', async () => {
            mockPromptManager.getPromptDefinition = vi.fn().mockResolvedValue({
                context: 'inline',
            });
            services.taskForker = mockTaskForker;

            const result = (await tool.execute({
                skill: 'simple-skill',
            })) as any;

            // Should NOT call fork
            expect(mockTaskForker.fork).not.toHaveBeenCalled();
            // Should return inline content
            expect(result.content).toContain('Skill instructions here');
            expect(result.forked).toBeUndefined();
        });

        it('should use inline execution when context is undefined', async () => {
            mockPromptManager.getPromptDefinition = vi.fn().mockResolvedValue({});
            services.taskForker = mockTaskForker;

            const result = (await tool.execute({
                skill: 'simple-skill',
            })) as any;

            expect(mockTaskForker.fork).not.toHaveBeenCalled();
            expect(result.content).toContain('Skill instructions here');
        });

        it('should pass toolCallId and sessionId to fork when provided', async () => {
            mockPromptManager.getPromptDefinition = vi.fn().mockResolvedValue({
                context: 'fork',
            });
            services.taskForker = mockTaskForker;

            await tool.execute(
                { skill: 'simple-skill' },
                { toolCallId: 'call-123', sessionId: 'session-456' }
            );

            expect(mockTaskForker.fork).toHaveBeenCalledWith(
                expect.objectContaining({
                    toolCallId: 'call-123',
                    sessionId: 'session-456',
                })
            );
        });
    });

    describe('PromptManager not available', () => {
        it('should return error when promptManager is not set', async () => {
            const emptyServices: InternalToolsServices = {};
            const toolWithoutManager = createInvokeSkillTool(emptyServices);

            const result = (await toolWithoutManager.execute({
                skill: 'any-skill',
            })) as any;

            expect(result.error).toContain('PromptManager not available');
        });
    });
});
