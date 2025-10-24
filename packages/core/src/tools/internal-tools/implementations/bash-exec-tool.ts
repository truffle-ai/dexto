/**
 * Bash Execute Tool
 *
 * Internal tool for executing shell commands (requires approval)
 */

import * as path from 'node:path';
import { z } from 'zod';
import { InternalTool, ToolExecutionContext } from '../../types.js';
import { ProcessService } from '../../../process/index.js';
import type { ApprovalManager } from '../../../approval/manager.js';
import { ApprovalStatus } from '../../../approval/types.js';
import { ProcessError } from '../../../process/errors.js';

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
export function createBashExecTool(
    processService: ProcessService,
    approvalManager: ApprovalManager
): InternalTool {
    return {
        id: 'bash_exec',
        description:
            'Execute a shell command. Returns stdout, stderr, exit code, and duration. Use run_in_background=true for long-running commands (use bash_output to retrieve results later). Requires approval for all commands. Dangerous commands (rm, git push, etc.) require additional per-command approval. Always quote file paths with spaces. Set timeout to prevent hanging commands. Security: dangerous commands are blocked, injection attempts are detected.',
        inputSchema: BashExecInputSchema,
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

            // Execute command using ProcessService with approval function for dangerous commands
            const result = await processService.executeCommand(command, {
                description,
                timeout,
                runInBackground: run_in_background,
                cwd: validatedCwd,
                // Provide approval function for dangerous commands
                approvalFunction: async (normalizedCommand: string) => {
                    // Build metadata conditionally to avoid passing undefined (exactOptionalPropertyTypes)
                    const metadata: {
                        toolName: string;
                        command: string;
                        originalCommand: string;
                        sessionId?: string;
                    } = {
                        toolName: 'bash_exec',
                        command: normalizedCommand,
                        originalCommand: command,
                    };

                    if (context?.sessionId) {
                        metadata.sessionId = context.sessionId;
                    }

                    const response = await approvalManager.requestCommandConfirmation(metadata);
                    return response.status === ApprovalStatus.APPROVED;
                },
            });

            // Type guard: if result has 'stdout', it's a ProcessResult (foreground)
            // Otherwise it's a ProcessHandle (background)
            if ('stdout' in result) {
                // Foreground execution result
                return {
                    stdout: result.stdout,
                    stderr: result.stderr,
                    exit_code: result.exitCode,
                    duration: result.duration,
                };
            } else {
                // Background execution handle
                return {
                    process_id: result.processId,
                    message: `Command started in background with ID: ${result.processId}. Use bash_output to retrieve output.`,
                };
            }
        },
    };
}
