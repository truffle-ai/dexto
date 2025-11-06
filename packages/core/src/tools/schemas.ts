import { z } from 'zod';
import { INTERNAL_TOOL_NAMES } from './internal-tools/constants.js';

export const TOOL_CONFIRMATION_MODES = ['event-based', 'auto-approve', 'auto-deny'] as const;
export type ToolConfirmationMode = (typeof TOOL_CONFIRMATION_MODES)[number];

export const ALLOWED_TOOLS_STORAGE_TYPES = ['memory', 'storage'] as const;
export type AllowedToolsStorageType = (typeof ALLOWED_TOOLS_STORAGE_TYPES)[number];

export const DEFAULT_TOOL_CONFIRMATION_MODE: ToolConfirmationMode = 'event-based';
export const DEFAULT_ALLOWED_TOOLS_STORAGE: AllowedToolsStorageType = 'storage';

// Internal tools schema - separate for type derivation

export const InternalToolsSchema = z
    .array(z.enum(INTERNAL_TOOL_NAMES).describe('Available internal tool names'))
    .default([])
    .describe(
        `Array of internal tool names to enable. Empty array = disabled. Available tools: ${INTERNAL_TOOL_NAMES.join(', ')}`
    );
// Derive type from schema
export type InternalToolsConfig = z.output<typeof InternalToolsSchema>;

// Tool policies schema - static allow/deny lists for fine-grained control
export const ToolPoliciesSchema = z
    .object({
        alwaysAllow: z
            .array(z.string())
            .default([])
            .describe(
                'Tools that never require approval (low-risk). Use full qualified names (e.g., "internal--ask_user", "mcp--filesystem--read_file")'
            ),
        alwaysDeny: z
            .array(z.string())
            .default([])
            .describe(
                'Tools that are always denied (high-risk). Takes precedence over alwaysAllow. Use full qualified names (e.g., "mcp--filesystem--delete_file")'
            ),
    })
    .strict()
    .default({ alwaysAllow: [], alwaysDeny: [] })
    .describe('Static tool policies for allow/deny lists');

export type ToolPolicies = z.output<typeof ToolPoliciesSchema>;

export const ToolConfirmationConfigSchema = z
    .object({
        mode: z
            .enum(TOOL_CONFIRMATION_MODES)
            .default(DEFAULT_TOOL_CONFIRMATION_MODE)
            .describe(
                'Tool confirmation mode: event-based (interactive), auto-approve (all tools), auto-deny (no tools)'
            ),
        timeout: z
            .number()
            .int()
            .positive()
            .default(120000)
            .describe(
                'Timeout for tool confirmation requests in milliseconds, defaults to 120000ms (2 mins)'
            ),
        allowedToolsStorage: z
            .enum(ALLOWED_TOOLS_STORAGE_TYPES)
            .default(DEFAULT_ALLOWED_TOOLS_STORAGE)
            .describe(
                'Storage type for remembered tool approvals: memory (session-only) or storage (persistent)'
            ),
        toolPolicies: ToolPoliciesSchema.describe(
            'Static tool policies for fine-grained allow/deny control. Deny list takes precedence over allow list.'
        ),
    })
    .strict()
    .describe('Tool confirmation and approval configuration');

export type ToolConfirmationConfig = z.input<typeof ToolConfirmationConfigSchema>;
export type ValidatedToolConfirmationConfig = z.output<typeof ToolConfirmationConfigSchema>;
