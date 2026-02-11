import { MCPErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { EnvExpandedString, RequiredEnvURL } from '../utils/result.js';
import { z } from 'zod';

export const MCP_SERVER_TYPES = ['stdio', 'sse', 'http'] as const;
export type McpServerType = (typeof MCP_SERVER_TYPES)[number];

export const MCP_CONNECTION_MODES = ['strict', 'lenient'] as const;
export type McpConnectionMode = (typeof MCP_CONNECTION_MODES)[number];

export const MCP_CONNECTION_STATUSES = [
    'connected',
    'disconnected',
    'error',
    'auth-required',
] as const;
export type McpConnectionStatus = (typeof MCP_CONNECTION_STATUSES)[number];

/**
 * MCP server info with computed connection status.
 * Returned by DextoAgent.getMcpServersWithStatus()
 */
export interface McpServerStatus {
    name: string;
    type: McpServerType;
    enabled: boolean;
    status: McpConnectionStatus;
    error?: string;
}

export const DEFAULT_MCP_CONNECTION_MODE: McpConnectionMode = 'lenient';

// ---- stdio ----

export const StdioServerConfigSchema = z
    .object({
        type: z.literal('stdio'),
        enabled: z
            .boolean()
            .default(true)
            .describe('Whether this server is enabled (disabled servers are not connected)'),
        // allow env in command & args if you want; remove EnvExpandedString if not desired
        command: EnvExpandedString().superRefine((s, ctx) => {
            if (s.length === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'Stdio server requires a non-empty command',
                    params: {
                        code: MCPErrorCode.COMMAND_MISSING,
                        scope: ErrorScope.MCP,
                        type: ErrorType.USER,
                    },
                });
            }
        }),
        args: z
            .array(EnvExpandedString())
            .default([])
            .describe("Array of arguments for the command (e.g., ['script.js'])"),
        env: z
            .record(EnvExpandedString())
            .default({})
            .describe('Optional environment variables for the server process'),
        timeout: z.coerce.number().int().positive().default(30000),
        connectionMode: z.enum(MCP_CONNECTION_MODES).default(DEFAULT_MCP_CONNECTION_MODE),
    })
    .strict();

export type StdioServerConfig = z.input<typeof StdioServerConfigSchema>;
export type ValidatedStdioServerConfig = z.output<typeof StdioServerConfigSchema>;
// ---- sse ----

export const SseServerConfigSchema = z
    .object({
        type: z.literal('sse'),
        enabled: z
            .boolean()
            .default(true)
            .describe('Whether this server is enabled (disabled servers are not connected)'),
        url: RequiredEnvURL(process.env).describe('URL for the SSE server endpoint'),
        headers: z.record(EnvExpandedString()).default({}),
        timeout: z.coerce.number().int().positive().default(30000),
        connectionMode: z.enum(MCP_CONNECTION_MODES).default(DEFAULT_MCP_CONNECTION_MODE),
    })
    .strict();

export type SseServerConfig = z.input<typeof SseServerConfigSchema>;
export type ValidatedSseServerConfig = z.output<typeof SseServerConfigSchema>;
// ---- http ----

export const HttpServerConfigSchema = z
    .object({
        type: z.literal('http'),
        enabled: z
            .boolean()
            .default(true)
            .describe('Whether this server is enabled (disabled servers are not connected)'),
        url: RequiredEnvURL(process.env).describe('URL for the HTTP server'),
        headers: z.record(EnvExpandedString()).default({}),
        timeout: z.coerce.number().int().positive().default(30000),
        connectionMode: z.enum(MCP_CONNECTION_MODES).default(DEFAULT_MCP_CONNECTION_MODE),
    })
    .strict();

export type HttpServerConfig = z.input<typeof HttpServerConfigSchema>;
export type ValidatedHttpServerConfig = z.output<typeof HttpServerConfigSchema>;
// ---- discriminated union ----

export const McpServerConfigSchema = z
    .discriminatedUnion('type', [
        StdioServerConfigSchema,
        SseServerConfigSchema,
        HttpServerConfigSchema,
    ])
    .superRefine((_data, _ctx) => {
        // cross-type business rules if you ever need them
    })
    .brand<'ValidatedMcpServerConfig'>();

export type McpServerConfig = z.input<typeof McpServerConfigSchema>;
export type ValidatedMcpServerConfig = z.output<typeof McpServerConfigSchema>;

export const ServerConfigsSchema = z
    .record(McpServerConfigSchema)
    .describe('A dictionary of server configurations, keyed by server name')
    .brand<'ValidatedServerConfigs'>();

export type ServerConfigs = z.input<typeof ServerConfigsSchema>;
export type ValidatedServerConfigs = z.output<typeof ServerConfigsSchema>;
