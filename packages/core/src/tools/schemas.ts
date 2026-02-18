import { z } from 'zod';

export const PERMISSIONS_MODES = ['manual', 'auto-approve', 'auto-deny'] as const;
export type PermissionsMode = (typeof PERMISSIONS_MODES)[number];

export const ALLOWED_TOOLS_STORAGE_TYPES = ['memory', 'storage'] as const;
export type AllowedToolsStorageType = (typeof ALLOWED_TOOLS_STORAGE_TYPES)[number];

export const DEFAULT_PERMISSIONS_MODE: PermissionsMode = 'auto-approve';
export const DEFAULT_ALLOWED_TOOLS_STORAGE: AllowedToolsStorageType = 'storage';

// Tool policies schema - static allow/deny lists for fine-grained control
export const ToolPoliciesSchema = z
    .object({
        alwaysAllow: z
            .array(z.string())
            .default([])
            .describe(
                'Tools that never require approval (low-risk). Use tool names (e.g., "ask_user", "mcp--filesystem--read_file")'
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

export const PermissionsConfigSchema = z
    .object({
        mode: z
            .enum(PERMISSIONS_MODES)
            .default(DEFAULT_PERMISSIONS_MODE)
            .describe(
                'Tool permissions mode: manual (interactive), auto-approve (all tools), auto-deny (no tools)'
            ),
        timeout: z
            .number()
            .int()
            .positive()
            .optional()
            .describe(
                'Timeout for tool confirmation requests in milliseconds. If not set, waits indefinitely.'
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
    .describe('Tool permissions and approval configuration');

export type PermissionsConfig = z.input<typeof PermissionsConfigSchema>;
export type ValidatedPermissionsConfig = z.output<typeof PermissionsConfigSchema>;

// Elicitation configuration schema - independent from tool permissions
export const ElicitationConfigSchema = z
    .object({
        enabled: z
            .boolean()
            .default(false)
            .describe(
                'Enable elicitation support (ask_user tool and MCP server elicitations). When disabled, elicitation requests will be rejected.'
            ),
        timeout: z
            .number()
            .int()
            .positive()
            .optional()
            .describe(
                'Timeout for elicitation requests in milliseconds. If not set, waits indefinitely.'
            ),
    })
    .strict()
    .describe(
        'Elicitation configuration for user input requests. Independent from tool permissions mode, allowing auto-approve for tools while still supporting elicitation.'
    );

export type ElicitationConfig = z.input<typeof ElicitationConfigSchema>;
export type ValidatedElicitationConfig = z.output<typeof ElicitationConfigSchema>;

// Tool limits configuration
export const ToolLimitsSchema = z
    .object({
        maxOutputChars: z
            .number()
            .optional()
            .describe('Maximum number of characters for tool output'),
        maxLines: z.number().optional().describe('Maximum number of lines for tool output'),
        maxLineLength: z.number().optional().describe('Maximum length of a single line'),
    })
    .strict();

export const ToolsConfigSchema = z
    .record(ToolLimitsSchema)
    .describe('Per-tool configuration limits');

export type ToolsConfig = z.output<typeof ToolsConfigSchema>;
