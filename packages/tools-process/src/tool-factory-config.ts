/**
 * Process Tools Factory
 *
 * Provides process execution and management tools by wrapping ProcessService.
 * When registered, the factory initializes ProcessService and creates tools
 * for command execution and process management.
 */

import { z } from 'zod';

/**
 * Default configuration constants for Process tools.
 * These are the SINGLE SOURCE OF TRUTH for all default values.
 */
const DEFAULT_SECURITY_LEVEL = 'moderate';
const DEFAULT_MAX_TIMEOUT = 600000; // 10 minutes
const DEFAULT_MAX_CONCURRENT_PROCESSES = 5;
const DEFAULT_MAX_OUTPUT_BUFFER = 1 * 1024 * 1024; // 1MB
const DEFAULT_ALLOWED_COMMANDS: string[] = [];
const DEFAULT_BLOCKED_COMMANDS: string[] = [];
const DEFAULT_ENVIRONMENT: Record<string, string> = {};

/**
 * Configuration schema for Process tools factory.
 *
 * This is the SINGLE SOURCE OF TRUTH for all configuration:
 * - Validation rules
 * - Default values (using constants above)
 * - Documentation
 * - Type definitions
 *
 * Services receive fully-validated config from this schema and use it as-is,
 * with no additional defaults or fallbacks needed.
 */
export const ProcessToolsConfigSchema = z
    .object({
        type: z.literal('process-tools'),
        securityLevel: z
            .enum(['strict', 'moderate', 'permissive'])
            .default(DEFAULT_SECURITY_LEVEL)
            .describe('Security level for command execution validation'),
        maxTimeout: z
            .number()
            .int()
            .positive()
            .max(DEFAULT_MAX_TIMEOUT)
            .default(DEFAULT_MAX_TIMEOUT)
            .describe(
                `Maximum timeout for commands in milliseconds (max: ${DEFAULT_MAX_TIMEOUT / 1000 / 60} minutes)`
            ),
        maxConcurrentProcesses: z
            .number()
            .int()
            .positive()
            .default(DEFAULT_MAX_CONCURRENT_PROCESSES)
            .describe(
                `Maximum number of concurrent background processes (default: ${DEFAULT_MAX_CONCURRENT_PROCESSES})`
            ),
        maxOutputBuffer: z
            .number()
            .int()
            .positive()
            .default(DEFAULT_MAX_OUTPUT_BUFFER)
            .describe(
                `Maximum output buffer size in bytes (default: ${DEFAULT_MAX_OUTPUT_BUFFER / 1024 / 1024}MB)`
            ),
        workingDirectory: z
            .string()
            .optional()
            .describe('Working directory for process execution (defaults to process.cwd())'),
        allowedCommands: z
            .array(z.string())
            .default(DEFAULT_ALLOWED_COMMANDS)
            .describe(
                'Explicitly allowed commands (empty = all allowed with approval, strict mode only)'
            ),
        blockedCommands: z
            .array(z.string())
            .default(DEFAULT_BLOCKED_COMMANDS)
            .describe('Blocked command patterns (applies to all security levels)'),
        environment: z
            .record(z.string())
            .default(DEFAULT_ENVIRONMENT)
            .describe('Custom environment variables to set for command execution'),
    })
    .strict();

export type ProcessToolsConfig = z.output<typeof ProcessToolsConfigSchema>;
