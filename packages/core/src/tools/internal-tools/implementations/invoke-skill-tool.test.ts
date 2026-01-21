import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInvokeSkillTool } from './invoke-skill-tool.js';
import type { PromptManager } from '../../../prompts/prompt-manager.js';

describe('invoke_skill tool', () => {
    let tool: ReturnType<typeof createInvokeSkillTool>;
    let mockPromptManager: Partial<PromptManager>;

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
        };

        tool = createInvokeSkillTool(mockPromptManager as PromptManager);
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
            expect(result.content.text).toContain('Skill instructions here');
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
            expect(result.content.text).toContain('Skill instructions here');
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

            expect(result.content.text).toContain('Part 1');
            expect(result.content.text).toContain('Part 2');
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
});
