import { z } from 'zod';

const DEFAULT_MAX_LOG_LINES = 200;
const DEFAULT_MAX_LOG_BYTES = 200_000;

export const LIFECYCLE_TOOL_NAMES = [
    'view_logs',
    'search_history',
    'memory_list',
    'memory_get',
    'memory_create',
    'memory_update',
    'memory_delete',
] as const;

export type LifecycleToolName = (typeof LIFECYCLE_TOOL_NAMES)[number];

export const LifecycleToolsConfigSchema = z
    .object({
        type: z.literal('lifecycle-tools'),
        enabledTools: z
            .array(z.enum(LIFECYCLE_TOOL_NAMES))
            .optional()
            .describe(
                `Subset of tools to enable. If not specified, all tools are enabled. Available: ${LIFECYCLE_TOOL_NAMES.join(', ')}`
            ),
        maxLogLines: z
            .number()
            .int()
            .positive()
            .default(DEFAULT_MAX_LOG_LINES)
            .describe(
                `Maximum number of log lines view_logs may return (default: ${DEFAULT_MAX_LOG_LINES})`
            ),
        maxLogBytes: z
            .number()
            .int()
            .positive()
            .default(DEFAULT_MAX_LOG_BYTES)
            .describe(
                `Maximum bytes read from the end of the log file (default: ${DEFAULT_MAX_LOG_BYTES})`
            ),
    })
    .strict();

export type LifecycleToolsConfig = z.output<typeof LifecycleToolsConfigSchema>;
