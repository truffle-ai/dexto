/**
 * Bash Execute Tool
 *
 * Internal tool for executing shell commands.
 * Approval is handled at the ToolManager level with pattern-based approval.
 */

import * as path from 'node:path';
import { z } from 'zod';
import { InternalTool, ToolExecutionContext } from '@dexto/core';
import { ProcessService } from './process-service.js';
import { ProcessError } from './errors.js';
import type { ShellDisplayData } from '@dexto/core';

const BashExecInputSchema = z
    .object({
        command: z.string().describe('Shell command to execute'),
        description: z
            .string()
            .optional()
            .describe('Human-readable description of what the command does (5-10 words)'),
        timeout: z
            .number()
            .int()
            .positive()
            .max(600000)
            .optional()
            .default(120000)
            .describe(
                'Timeout in milliseconds (max: 600000 = 10 minutes, default: 120000 = 2 minutes)'
            ),
        run_in_background: z
            .boolean()
            .optional()
            .default(false)
            .describe('Execute command in background (default: false)'),
        cwd: z.string().optional().describe('Working directory for command execution (optional)'),
    })
    .strict();

type BashExecInput = z.input<typeof BashExecInputSchema>;

/**
 * Create the bash_exec internal tool
 */
export function createBashExecTool(processService: ProcessService): InternalTool {
    return {
        id: 'bash_exec',
        description:
            'Execute a shell command with 2-minute default timeout. Default working directory is the project root; each command runs in a fresh shell so cd does not persist between calls. Returns stdout, stderr, exit code, and duration. For long-running commands (servers, watchers, npm run dev), MUST use run_in_background=true (use bash_output to retrieve results later). Commands ending with & are blocked - use run_in_background instead. Requires approval (with pattern-based session memory). Always quote file paths with spaces. Security: dangerous commands are blocked, injection attempts are detected.',
        inputSchema: BashExecInputSchema,

        /**
         * Generate preview for approval UI - shows the command to be executed
         */
        generatePreview: async (input: unknown, _context?: ToolExecutionContext) => {
            const { command, run_in_background } = input as BashExecInput;

            const preview: ShellDisplayData = {
                type: 'shell',
                command,
                exitCode: 0, // Placeholder - not executed yet
                duration: 0, // Placeholder - not executed yet
                ...(run_in_background !== undefined && { isBackground: run_in_background }),
            };
            return preview;
        },

        execute: async (input: unknown, context?: ToolExecutionContext) => {
            // Input is validated by provider before reaching here
            const { command, description, timeout, run_in_background, cwd } =
                input as BashExecInput;

            // Validate cwd to prevent path traversal
            let validatedCwd: string | undefined = cwd;
            if (cwd) {
                const baseDir = processService.getConfig().workingDirectory || process.cwd();

                // Resolve cwd to absolute path
                const candidatePath = path.isAbsolute(cwd)
                    ? path.resolve(cwd)
                    : path.resolve(baseDir, cwd);

                // Check if cwd is within the base directory
                const relativePath = path.relative(baseDir, candidatePath);
                const isOutsideBase =
                    relativePath.startsWith('..') || path.isAbsolute(relativePath);

                if (isOutsideBase) {
                    throw ProcessError.invalidWorkingDirectory(
                        cwd,
                        `Working directory must be within ${baseDir}`
                    );
                }

                validatedCwd = candidatePath;
            }

            // Execute command using ProcessService
            // Note: Approval is handled at ToolManager level with pattern-based approval
            const result = await processService.executeCommand(command, {
                description,
                timeout,
                runInBackground: run_in_background,
                cwd: validatedCwd,
                // Pass abort signal for cancellation support
                abortSignal: context?.abortSignal,
            });

            // Type guard: if result has 'stdout', it's a ProcessResult (foreground)
            // Otherwise it's a ProcessHandle (background)
            if ('stdout' in result) {
                // Foreground execution result
                const _display: ShellDisplayData = {
                    type: 'shell',
                    command,
                    exitCode: result.exitCode,
                    duration: result.duration,
                    isBackground: false,
                    stdout: result.stdout,
                    stderr: result.stderr,
                };

                return {
                    stdout: result.stdout,
                    stderr: result.stderr,
                    exit_code: result.exitCode,
                    duration: result.duration,
                    _display,
                };
            } else {
                // Background execution handle
                const _display: ShellDisplayData = {
                    type: 'shell',
                    command,
                    exitCode: 0, // Background process hasn't exited yet
                    duration: 0, // Still running
                    isBackground: true,
                };

                return {
                    process_id: result.processId,
                    message: `Command started in background with ID: ${result.processId}. Use bash_output to retrieve output.`,
                    _display,
                };
            }
        },
    };
}
