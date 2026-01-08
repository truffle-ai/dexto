/**
 * Logger Configuration Schemas
 *
 * Zod schemas for logger configuration with multi-transport support.
 * Supports console, file, and optional remote (Upstash) transports.
 */

import { z } from 'zod';

/**
 * Silent transport configuration (no-op, discards all logs)
 */
const SilentTransportSchema = z
    .object({
        type: z.literal('silent'),
    })
    .strict()
    .describe('Silent transport that discards all logs (useful for sub-agents)');

/**
 * Console transport configuration
 */
const ConsoleTransportSchema = z
    .object({
        type: z.literal('console'),
        colorize: z.boolean().default(true).describe('Enable colored output'),
    })
    .strict()
    .describe('Console transport for terminal output');

/**
 * File transport configuration with rotation support
 */
const FileTransportSchema = z
    .object({
        type: z.literal('file'),
        path: z.string().describe('Absolute path to log file'),
        maxSize: z
            .number()
            .positive()
            .default(10 * 1024 * 1024)
            .describe('Max file size in bytes before rotation (default: 10MB)'),
        maxFiles: z
            .number()
            .int()
            .positive()
            .default(5)
            .describe('Max number of rotated files to keep (default: 5)'),
    })
    .strict()
    .describe('File transport with rotation support');

/**
 * Upstash Redis transport configuration (optional remote logging)
 */
const UpstashTransportSchema = z
    .object({
        type: z.literal('upstash'),
        url: z.string().url().describe('Upstash Redis REST URL'),
        token: z.string().describe('Upstash Redis REST token'),
        listName: z.string().default('dexto-logs').describe('Redis list name for log entries'),
        maxListLength: z
            .number()
            .int()
            .positive()
            .default(10000)
            .describe('Max entries in Redis list (default: 10000)'),
        batchSize: z
            .number()
            .int()
            .positive()
            .default(100)
            .describe('Number of log entries to batch before sending (default: 100)'),
    })
    .strict()
    .describe('Upstash Redis transport for remote logging');

/**
 * Transport configuration (discriminated union)
 */
export const LoggerTransportSchema = z.discriminatedUnion('type', [
    SilentTransportSchema,
    ConsoleTransportSchema,
    FileTransportSchema,
    UpstashTransportSchema,
]);

export type LoggerTransportConfig = z.output<typeof LoggerTransportSchema>;

/**
 * Logger configuration schema
 */
export const LoggerConfigSchema = z
    .object({
        level: z
            .enum(['debug', 'info', 'warn', 'error', 'silly'])
            .default('error')
            .describe('Minimum log level to record'),
        transports: z
            .array(LoggerTransportSchema)
            .min(1)
            .default([{ type: 'console', colorize: true }])
            .describe('Log output destinations'),
    })
    .strict()
    .describe('Logger configuration with multi-transport support');

export type LoggerConfig = z.output<typeof LoggerConfigSchema>;
