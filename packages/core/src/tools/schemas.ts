import { z } from 'zod';
import { INTERNAL_TOOL_NAMES } from './internal-tools/constants.js';
import { customToolSchemaRegistry } from './custom-tool-schema-registry.js';

export const TOOL_CONFIRMATION_MODES = ['manual', 'auto-approve', 'auto-deny'] as const;
export type ToolConfirmationMode = (typeof TOOL_CONFIRMATION_MODES)[number];

export const ALLOWED_TOOLS_STORAGE_TYPES = ['memory', 'storage'] as const;
export type AllowedToolsStorageType = (typeof ALLOWED_TOOLS_STORAGE_TYPES)[number];

export const DEFAULT_TOOL_CONFIRMATION_MODE: ToolConfirmationMode = 'auto-approve';
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

/**
 * Get the custom tool config schema based on registered providers.
 *
 * This function creates a discriminated union of all registered provider schemas,
 * enabling early validation of provider-specific fields at config load time.
 *
 * IMPORTANT: Providers must be registered (via image imports or customToolRegistry)
 * before config validation for early validation to work. If no providers are
 * registered, falls back to passthrough schema for backward compatibility.
 *
 * @returns Discriminated union schema or passthrough schema
 */
function getCustomToolConfigSchema(): z.ZodType<any> {
    return customToolSchemaRegistry.createUnionSchema();
}

/**
 * Custom tool configuration schema.
 *
 * This schema is built dynamically from registered providers:
 * - If providers are registered → discriminated union with full validation
 * - If no providers registered → passthrough schema (backward compatible)
 *
 * Provider-specific fields are validated based on their registered schemas.
 */
export const CustomToolConfigSchema = z.lazy(() => getCustomToolConfigSchema());

export type CustomToolConfig = z.output<typeof CustomToolConfigSchema>;

/**
 * OpenAPI-safe version of CustomToolConfigSchema.
 * Uses a generic object schema instead of lazy loading for OpenAPI compatibility.
 */
export const CustomToolConfigSchemaForOpenAPI = z
    .object({
        type: z.string().describe('Tool provider type identifier'),
    })
    .passthrough()
    .describe('Custom tool provider configuration (generic representation for OpenAPI docs)');

/**
 * Array of custom tool provider configurations.
 *
 * Custom tools must be registered via customToolRegistry before loading agent config
 * for early validation to work. If providers are not registered, validation will
 * fall back to runtime validation by the provider.
 */
export const CustomToolsSchema = z
    .array(CustomToolConfigSchema)
    .default([])
    .describe(
        'Array of custom tool provider configurations. Providers are validated against registered schemas.'
    );

export type CustomToolsConfig = z.output<typeof CustomToolsSchema>;

/**
 * OpenAPI-safe version of CustomToolsSchema.
 * Uses generic object schema for OpenAPI compatibility.
 */
export const CustomToolsSchemaForOpenAPI = z
    .array(CustomToolConfigSchemaForOpenAPI)
    .default([])
    .describe('Array of custom tool provider configurations');

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
                'Tool confirmation mode: manual (interactive), auto-approve (all tools), auto-deny (no tools)'
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
    .describe('Tool confirmation and approval configuration');

export type ToolConfirmationConfig = z.input<typeof ToolConfirmationConfigSchema>;
export type ValidatedToolConfirmationConfig = z.output<typeof ToolConfirmationConfigSchema>;

// Elicitation configuration schema - independent from tool confirmation
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
        'Elicitation configuration for user input requests. Independent from tool confirmation mode, allowing auto-approve for tools while still supporting elicitation.'
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
