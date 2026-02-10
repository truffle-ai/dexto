/**
 * Process Tools Provider
 *
 * Provides process execution and management tools by wrapping ProcessService.
 * When registered, the provider initializes ProcessService and creates tools
 * for command execution and process management.
 */

import { z } from 'zod';
import type { CustomToolProvider, ToolCreationContext } from '@dexto/core';
import type { InternalTool } from '@dexto/core';
import { ProcessService } from './process-service.js';
import { createBashExecTool } from './bash-exec-tool.js';
import { createBashOutputTool } from './bash-output-tool.js';
import { createKillProcessTool } from './kill-process-tool.js';

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
 * Configuration schema for Process tools provider.
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
        timeout: z
            .number()
            .int()
            .positive()
            .max(DEFAULT_MAX_TIMEOUT)
            .optional()
            .describe(
                `Default timeout in milliseconds (max: ${DEFAULT_MAX_TIMEOUT / 1000 / 60} minutes)`
            ),
    })
    .strict();

export type ProcessToolsConfig = z.output<typeof ProcessToolsConfigSchema>;

/**
 * Process tools provider.
 *
 * Wraps ProcessService and provides process operation tools:
 * - bash_exec: Execute bash commands (foreground or background)
 * - bash_output: Retrieve output from background processes
 * - kill_process: Terminate background processes
 *
 * When registered via customToolRegistry, ProcessService is automatically
 * initialized and process operation tools become available to the agent.
 */
export const processToolsProvider: CustomToolProvider<'process-tools', ProcessToolsConfig> = {
    type: 'process-tools',
    configSchema: ProcessToolsConfigSchema,

    create: (config: ProcessToolsConfig, context: ToolCreationContext): InternalTool[] => {
        const { logger } = context;

        logger.debug('Creating ProcessService for process tools');

        // Create ProcessService with validated config
        const processService = new ProcessService(
            {
                securityLevel: config.securityLevel,
                maxTimeout: config.maxTimeout,
                maxConcurrentProcesses: config.maxConcurrentProcesses,
                maxOutputBuffer: config.maxOutputBuffer,
                workingDirectory: config.workingDirectory || process.cwd(),
                allowedCommands: config.allowedCommands,
                blockedCommands: config.blockedCommands,
                environment: config.environment,
            },
            logger
        );

        // Start initialization in background - service methods use ensureInitialized() for lazy init
        // This means tools will wait for initialization to complete before executing
        processService.initialize().catch((error) => {
            logger.error(`Failed to initialize ProcessService: ${error.message}`);
        });

        logger.debug('ProcessService created - initialization will complete on first tool use');

        // Create and return all process operation tools
        return [
            createBashExecTool(processService),
            createBashOutputTool(processService),
            createKillProcessTool(processService),
        ];
    },

    metadata: {
        displayName: 'Process Tools',
        description: 'Process execution and management (bash, output, kill)',
        category: 'process',
    },
};
