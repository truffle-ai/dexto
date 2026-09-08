import { z } from 'zod';

/**
 * Returns whether a supporting-file path is relative and cannot traverse above its Skill root.
 * This is shared by the tool schema and local filesystem implementations so they enforce the same
 * contract on POSIX and Windows-style paths.
 */
export function isSafeRelativeSkillPath(value: string): boolean {
    if (value.startsWith('/') || value.startsWith('\\')) return false;
    if (/^[A-Za-z]:/u.test(value)) return false;
    return !value.split(/[\\/]/u).includes('..');
}

/**
 * Input shared by every `skill_load` implementation.
 *
 * `name` is the canonical key returned by `Skills.list`; it is deliberately not
 * an alias, display label, or source-qualified fallback. `path`, when present,
 * is relative to the selected Skill's supporting files.
 */
export const SkillLoadInputSchema = z
    .object({
        name: z
            .string()
            .min(1, 'Skill name is required')
            .describe('The exact Skill name shown in the available Skills list'),
        path: z
            .string()
            .min(1)
            .refine(
                isSafeRelativeSkillPath,
                'Skill file path must be relative to the selected Skill'
            )
            .optional()
            .describe('Optional relative path of a supporting file from the selected Skill'),
    })
    .strict();

export type SkillLoadInput = z.output<typeof SkillLoadInputSchema>;
