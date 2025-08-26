import { z } from 'zod';
import { INTERNAL_TOOL_NAMES } from './internal-tools/registry.js';

// Internal tools schema - separate for type derivation

export const InternalToolsSchema = z
    .array(z.enum(INTERNAL_TOOL_NAMES).describe('Available internal tool names'))
    .default([])
    .describe(
        `Array of internal tool names to enable. Empty array = disabled. Available tools: ${INTERNAL_TOOL_NAMES.join(', ')}`
    );
// Derive type from schema
export type InternalToolsConfig = z.output<typeof InternalToolsSchema>;

export const ToolConfirmationConfigSchema = z
    .object({
        mode: z
            .enum(['event-based', 'auto-approve', 'auto-deny'])
            .default('event-based')
            .describe(
                'Tool confirmation mode: event-based (interactive), auto-approve (all tools), auto-deny (no tools)'
            ),
        timeout: z
            .number()
            .int()
            .positive()
            .default(30000)
            .describe(
                'Timeout for tool confirmation requests in milliseconds, defaults to 30000ms (30 seconds)'
            ),
        allowedToolsStorage: z
            .enum(['memory', 'storage'])
            .default('storage')
            .describe(
                'Storage type for remembered tool approvals: memory (session-only) or storage (persistent)'
            ),
    })
    .strict()
    .describe('Tool confirmation and approval configuration');

export type ToolConfirmationConfig = z.input<typeof ToolConfirmationConfigSchema>;
export type ValidatedToolConfirmationConfig = z.output<typeof ToolConfirmationConfigSchema>;
