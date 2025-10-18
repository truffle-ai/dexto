/**
 * Bash Execute Tool
 *
 * Internal tool for executing shell commands (requires approval)
 */

import { z } from 'zod';
import { InternalTool, ToolExecutionContext } from '../../types.js';
import { ProcessService } from '../../../process/index.js';

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
            'Execute a shell command. Returns stdout, stderr, exit code, and duration. Use run_in_background=true for long-running commands (use bash_output to retrieve results later). Requires approval for all commands. Always quote file paths with spaces. Set timeout to prevent hanging commands. Security: dangerous commands are blocked, injection attempts are detected.',
        inputSchema: BashExecInputSchema,
        execute: async (input: unknown, _context?: ToolExecutionContext) => {
            // Input is validated by provider before reaching here
            const { command, description, timeout, run_in_background, cwd } =
                input as BashExecInput;

            // Execute command using ProcessService
            const result = await processService.executeCommand(command, {
                description,
                timeout,
                runInBackground: run_in_background,
                cwd,
            });

            if (run_in_background) {
                return {
                    process_id: result.processId,
                    message: `Command started in background with ID: ${result.processId}. Use bash_output to retrieve output.`,
                };
            }

            return {
                stdout: result.stdout,
                stderr: result.stderr,
                exit_code: result.exitCode,
                duration: result.duration,
            };
        },
    };
}
