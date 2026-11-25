import { z } from 'zod';
export { ToolIdentitySchema } from './identity.js';

/**
 * Permission modes, matching the hosted app:
 * - `full-access` ("Full access"): tools run without asking.
 * - `asks-you` ("Asks you"): the agent asks before file edits, shell commands and other
 *   approval-sensitive actions.
 */
export const PERMISSIONS_MODES = ['full-access', 'asks-you'] as const;
export type PermissionsMode = (typeof PERMISSIONS_MODES)[number];

export const PERMISSIONS_MODE_LABELS: Readonly<Record<PermissionsMode, string>> = {
    'full-access': 'Full access',
    'asks-you': 'Asks you',
};

/**
 * Deprecated mode values and the mode each one maps to. Accepted for one release, then removed.
 */
export const LEGACY_PERMISSIONS_MODES = {
    manual: 'asks-you',
    'auto-approve': 'full-access',
} as const satisfies Record<string, PermissionsMode>;
export type LegacyPermissionsMode = keyof typeof LEGACY_PERMISSIONS_MODES;

function isLegacyPermissionsMode(value: unknown): value is LegacyPermissionsMode {
    return typeof value === 'string' && Object.hasOwn(LEGACY_PERMISSIONS_MODES, value);
}

/**
 * Returns the deprecation warning for an old `permissions.mode` value, or null when the value is
 * not deprecated. Hosts print it where they read raw config or flags.
 */
export function getDeprecatedPermissionsModeWarning(value: unknown): string | null {
    if (!isLegacyPermissionsMode(value)) {
        return null;
    }
    const replacement = LEGACY_PERMISSIONS_MODES[value];
    return `Permissions mode "${value}" is deprecated; use "${replacement}" (${PERMISSIONS_MODE_LABELS[replacement]}) instead. "${value}" will stop working in the next release.`;
}

/** Maps a current or deprecated mode value to the current mode. */
export function resolvePermissionsMode(
    value: PermissionsMode | LegacyPermissionsMode
): PermissionsMode {
    return isLegacyPermissionsMode(value) ? LEGACY_PERMISSIONS_MODES[value] : value;
}

const PermissionsModeSchema = z
    .enum([...PERMISSIONS_MODES, 'manual', 'auto-approve'])
    .transform(resolvePermissionsMode);

export const ALLOWED_TOOLS_STORAGE_TYPES = ['memory', 'storage'] as const;
export type AllowedToolsStorageType = (typeof ALLOWED_TOOLS_STORAGE_TYPES)[number];

export const DEFAULT_PERMISSIONS_MODE: PermissionsMode = 'full-access';
export const DEFAULT_ALLOWED_TOOLS_STORAGE: AllowedToolsStorageType = 'storage';

// Tool policies schema - static allow list for fine-grained approval control
export const ToolPoliciesSchema = z
    .object({
        alwaysAllow: z
            .array(z.string())
            .default([])
            .describe(
                'Tools that never require approval (low-risk). Use tool names (e.g., "ask_user", "mcp--filesystem--read_file")'
            ),
    })
    .strict()
    .default({ alwaysAllow: [] })
    .describe('Static tool policies for approval allow lists');

export type ToolPolicies = z.output<typeof ToolPoliciesSchema>;

export const PermissionsConfigSchema = z
    .object({
        mode: PermissionsModeSchema.default(DEFAULT_PERMISSIONS_MODE).describe(
            'Tool permissions mode: full-access (Full access: tools run without asking) or asks-you (Asks you: asks before file edits, shell commands and other approval-sensitive actions). The deprecated values auto-approve and manual map to full-access and asks-you.'
        ),
        timeout: z
            .number()
            .int()
            .positive()
            .optional()
            .describe(
                'Timeout for tool approval requests in milliseconds. If not set, waits indefinitely.'
            ),
        allowedToolsStorage: z
            .enum(ALLOWED_TOOLS_STORAGE_TYPES)
            .default(DEFAULT_ALLOWED_TOOLS_STORAGE)
            .describe(
                'Storage type for remembered tool approvals: memory (session-only) or storage (persistent)'
            ),
        toolPolicies: ToolPoliciesSchema.describe(
            'Static tool policies for fine-grained approval allow control.'
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
        'Elicitation configuration for user input requests. Independent from tool permissions mode, allowing Full access for tools while still supporting elicitation.'
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
    .record(z.string(), ToolLimitsSchema)
    .describe('Per-tool configuration limits');

export type ToolsConfig = z.output<typeof ToolsConfigSchema>;
