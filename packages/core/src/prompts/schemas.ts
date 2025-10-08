/**
 * Zod schemas for prompt-related configurations
 */

import { z } from 'zod';

/**
 * Schema for starter prompts configuration
 *
 * Starter prompts appear as clickable buttons in the WebUI, providing users
 * with quick-start templates for common tasks and interactions.
 */
export const StarterPromptsSchema = z
    .array(
        z
            .object({
                id: z
                    .string()
                    .min(1)
                    .max(64)
                    .regex(/^[a-z0-9-]+$/)
                    .describe('Kebab-case slug id for the starter prompt (e.g., quick-start)'),
                title: z.string().optional().describe('Display title for the starter prompt'),
                description: z
                    .string()
                    .optional()
                    .default('')
                    .describe('Description shown on hover or in the UI'),
                prompt: z.string().describe('The actual prompt text that gets resolved and sent'),
                category: z
                    .string()
                    .optional()
                    .default('general')
                    .describe(
                        'Category for organizing starter prompts (e.g., general, coding, analysis, tools, learning)'
                    ),
                priority: z.number().optional().default(0).describe('Higher numbers appear first'),
            })
            .strict()
    )
    .superRefine((arr, ctx) => {
        const seen = new Map<string, number>();
        arr.forEach((p, idx) => {
            if (seen.has(p.id)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Duplicate starterPrompt id: ${p.id}`,
                    path: ['starterPrompts', idx, 'id'],
                });
            } else {
                seen.set(p.id, idx);
            }
        });
    })
    .transform((arr) => arr.map((p) => ({ ...p, title: p.title ?? p.id.replace(/-/g, ' ') })))
    .default([])
    .describe('Starter prompts that appear as clickable buttons in the WebUI');

/**
 * Validated starter prompts configuration type
 */
export type ValidatedStarterPromptsConfig = z.output<typeof StarterPromptsSchema>;
