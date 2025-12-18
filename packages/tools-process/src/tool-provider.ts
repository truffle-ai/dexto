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
 * Configuration schema for Process tools provider
 */
const ProcessToolsConfigSchema = z
    .object({
        type: z.literal('process-tools'),
        securityLevel: z
            .enum(['strict', 'moderate', 'permissive'])
            .optional()
            .default('moderate')
            .describe('Security level for command execution validation'),
        maxTimeout: z
            .number()
            .int()
            .positive()
            .max(600000)
            .optional()
            .default(600000) // 10 minutes
            .describe('Maximum timeout for commands in milliseconds (max: 600000 = 10 minutes)'),
        maxConcurrentProcesses: z
            .number()
            .int()
            .positive()
            .optional()
            .default(5)
            .describe('Maximum number of concurrent background processes'),
        maxOutputBuffer: z
            .number()
            .int()
            .positive()
            .optional()
            .default(1 * 1024 * 1024) // 1MB
            .describe('Maximum output buffer size in bytes (default: 1MB)'),
        workingDirectory: z
            .string()
            .optional()
            .describe('Working directory for process execution (defaults to process.cwd())'),
        allowedCommands: z
            .array(z.string())
            .optional()
            .default([])
            .describe(
                'Explicitly allowed commands (empty = all allowed with approval, strict mode only)'
            ),
        blockedCommands: z
            .array(z.string())
            .optional()
            .default([])
            .describe('Blocked command patterns (applies to all security levels)'),
        environment: z
            .record(z.string())
            .optional()
            .default({})
            .describe('Custom environment variables to set for command execution'),
        timeout: z
            .number()
            .int()
            .positive()
            .max(600000)
            .optional()
            .describe('Default timeout in milliseconds (max: 600000 = 10 minutes)'),
    })
    .strict();

type ProcessToolsConfig = z.output<typeof ProcessToolsConfigSchema>;

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

        // Initialize service (synchronous in current implementation)
        processService.initialize().catch((error) => {
            logger.error(`Failed to initialize ProcessService: ${error.message}`);
            throw error;
        });

        logger.info('ProcessService initialized - process operation tools available');

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
