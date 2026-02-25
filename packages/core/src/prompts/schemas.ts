/**
 * Zod schemas for prompt-related configurations
 *
 * Unified prompt system with discriminated union:
 * - type: 'inline' - Prompt text defined directly in config
 * - type: 'file' - Prompt loaded from a markdown file
 *
 * Both support showInStarters flag to control WebUI button display.
 */

import { z } from 'zod';
import { PROMPT_NAME_REGEX, PROMPT_NAME_GUIDANCE } from './name-validation.js';

/**
 * Schema for inline prompts - text defined directly in config
 */
export const InlinePromptSchema = z
    .object({
        type: z.literal('inline').describe('Inline prompt type'),
        id: z
            .string()
            .min(1)
            .max(64)
            .regex(PROMPT_NAME_REGEX, `Prompt id must be ${PROMPT_NAME_GUIDANCE}`)
            .describe('Kebab-case slug id for the prompt (e.g., quick-start)'),
        title: z.string().optional().describe('Display title for the prompt'),
        description: z
            .string()
            .optional()
            .default('')
            .describe('Description shown on hover or in the UI'),
        prompt: z.string().describe('The actual prompt text'),
        category: z
            .string()
            .optional()
            .default('general')
            .describe('Category for organizing prompts (e.g., general, coding, analysis, tools)'),
        priority: z
            .number()
            .optional()
            .default(0)
            .describe('Higher numbers appear first in the list'),
        showInStarters: z
            .boolean()
            .optional()
            .default(false)
            .describe('Show as a clickable button in WebUI starter prompts'),
        // Claude Code compatibility fields (Phase 1)
        'disable-model-invocation': z
            .boolean()
            .optional()
            .default(false)
            .describe('Exclude from auto-invocation list in system prompt'),
        'user-invocable': z
            .boolean()
            .optional()
            .default(true)
            .describe('Show in slash command menu (false = hidden but auto-invocable by LLM)'),
        // Per-prompt overrides (Phase 2)
        'allowed-tools': z
            .array(z.string())
            .optional()
            .describe('Tools to auto-approve when this prompt is active (additive)'),
        model: z.string().optional().describe('Model to use when this prompt is invoked'),
        // Execution context (Phase 2)
        context: z
            .enum(['inline', 'fork'])
            .optional()
            .default('inline')
            .describe(
                "Execution context: 'inline' runs in current session (default), 'fork' spawns isolated subagent"
            ),
        // Agent for fork execution
        agent: z
            .string()
            .optional()
            .describe('Agent ID from registry to use for fork execution (e.g., "explore-agent")'),
    })
    .strict()
    .describe('Inline prompt with text defined directly in config');

/**
 * Schema for file-based prompts - loaded from markdown files
 */
export const FilePromptSchema = z
    .object({
        type: z.literal('file').describe('File-based prompt type'),
        file: z
            .string()
            .describe(
                'Path to markdown file containing prompt (supports ${{dexto.agent_dir}} template)'
            ),
        showInStarters: z
            .boolean()
            .optional()
            .default(false)
            .describe('Show as a clickable button in WebUI starter prompts'),
        // Claude Code compatibility fields (Phase 1) - can override frontmatter
        'disable-model-invocation': z
            .boolean()
            .optional()
            .describe('Exclude from auto-invocation list in system prompt'),
        'user-invocable': z
            .boolean()
            .optional()
            .describe('Show in slash command menu (false = hidden but auto-invocable by LLM)'),
        // Per-prompt overrides (Phase 2) - can override frontmatter
        'allowed-tools': z
            .array(z.string())
            .optional()
            .describe('Tools to auto-approve when this prompt is active (additive)'),
        model: z.string().optional().describe('Model to use when this prompt is invoked'),
        // Execution context (Phase 2) - can override frontmatter
        context: z
            .enum(['inline', 'fork'])
            .optional()
            .describe(
                "Execution context: 'inline' runs in current session (default), 'fork' spawns isolated subagent"
            ),
        // Agent for fork execution - can override frontmatter
        agent: z
            .string()
            .optional()
            .describe('Agent ID from registry to use for fork execution (e.g., "explore-agent")'),
        // Plugin namespace (Phase 3) - for prefixing command names
        namespace: z
            .string()
            .optional()
            .describe('Plugin namespace for command prefixing (e.g., plugin-name:command)'),
    })
    .strict()
    .describe('File-based prompt loaded from a markdown file');

/**
 * Unified prompts schema - array of inline or file-based prompts
 * Replaces the old StarterPromptsSchema
 */
export const PromptsSchema = z
    .array(z.discriminatedUnion('type', [InlinePromptSchema, FilePromptSchema]))
    .superRefine((arr, ctx) => {
        // Check for duplicate inline prompt IDs
        const seen = new Map<string, number>();
        arr.forEach((p, idx) => {
            if (p.type === 'inline') {
                if (seen.has(p.id)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Duplicate prompt id: ${p.id}`,
                        path: [idx, 'id'],
                    });
                } else {
                    seen.set(p.id, idx);
                }
            }
        });
    })
    .transform((arr) =>
        arr.map((p) => {
            if (p.type === 'inline') {
                // Auto-generate title from id if not provided
                return { ...p, title: p.title ?? p.id.replace(/-/g, ' ') };
            }
            return p;
        })
    )
    .default([])
    .describe('Agent prompts - inline text or file-based');

/**
 * Type for a single inline prompt (validated)
 */
export type ValidatedInlinePrompt = z.output<typeof InlinePromptSchema>;

/**
 * Type for a single file-based prompt (validated)
 */
export type ValidatedFilePrompt = z.output<typeof FilePromptSchema>;

/**
 * Type for a single prompt (either inline or file)
 */
export type ValidatedPrompt = ValidatedInlinePrompt | ValidatedFilePrompt;

/**
 * Input type for a single inline prompt (before validation)
 */
export type InlinePrompt = z.input<typeof InlinePromptSchema>;

/**
 * Input type for a single file-based prompt (before validation)
 */
export type FilePrompt = z.input<typeof FilePromptSchema>;

/**
 * Input type for a single prompt (before validation)
 */
export type Prompt = InlinePrompt | FilePrompt;

/**
 * Validated prompts configuration type
 */
export type ValidatedPromptsConfig = z.output<typeof PromptsSchema>;

/**
 * Input type for prompts configuration (before validation)
 */
export type PromptsConfig = z.input<typeof PromptsSchema>;
