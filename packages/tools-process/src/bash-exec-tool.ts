/**
 * Bash Execute Tool
 *
 * Internal tool for executing shell commands.
 * Pattern-based approval support is declared on the tool (ToolManager stays generic).
 */

import * as path from 'node:path';
import { z } from 'zod';
import { Tool, ToolExecutionContext } from '@dexto/core';
import { ProcessService } from './process-service.js';
import { ProcessError } from './errors.js';
import type { ShellDisplayData } from '@dexto/core';
import {
    generateCommandPatternKey,
    generateCommandPatternSuggestions,
} from './command-pattern-utils.js';

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
export type ProcessServiceGetter = (context: ToolExecutionContext) => Promise<ProcessService>;

export function createBashExecTool(getProcessService: ProcessServiceGetter): Tool {
    return {
        id: 'bash_exec',
        displayName: 'Bash',
        aliases: ['bash'],
        description: `Execute a shell command in the project root directory.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. Do NOT use it for file operations - use the specialized tools instead:
- File search: Use glob_files (NOT find or ls)
- Content search: Use grep_content (NOT grep or rg)
- Read files: Use read_file (NOT cat/head/tail)
- Edit files: Use edit_file (NOT sed/awk)
- Write files: Use write_file (NOT echo/cat with heredoc)

Before executing the command, follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use ls to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first use ls foo to check that "foo" exists

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes
   - Examples of proper quoting:
     - cd "/Users/name/My Documents" (correct)
     - cd /Users/name/My Documents (incorrect - will fail)
     - python "/path/with spaces/script.py" (correct)
     - python /path/with spaces/script.py (incorrect - will fail)

Usage notes:
- The command argument is required.
- You can specify an optional timeout in milliseconds (max 600000ms / 10 minutes). Default is 120000ms (2 minutes).
- The description parameter should be a clear, concise summary of what the command does (5-10 words for simple commands, more context for complex commands).
- If the output exceeds 1MB, it will be truncated.
- You can use run_in_background=true to run the command in the background. Use this when you don't need the result immediately. You do not need to check the output right away - use bash_output to retrieve results later. Commands ending with & are blocked; use run_in_background instead.

When issuing multiple commands:
- If the commands are independent and can run in parallel, make multiple bash_exec calls in a single response.
- If the commands depend on each other and must run sequentially, use a single call with && to chain them (e.g., git add . && git commit -m "msg" && git push).
- Use ; only when you need to run commands sequentially but don't care if earlier commands fail.
- Do NOT use newlines to separate commands (newlines are ok in quoted strings).

Try to maintain your working directory throughout the session by using absolute paths and avoiding usage of cd. You may use cd if the user explicitly requests it.
- GOOD: pnpm test
- GOOD: pytest /absolute/path/to/tests
- BAD: cd /project && pnpm test
- BAD: cd /some/path && command

Each command runs in a fresh shell, so cd does not persist between calls.

Security: Dangerous commands are blocked. Injection attempts are detected. Requires approval with pattern-based session memory.`,
        inputSchema: BashExecInputSchema,

        getApprovalPatternKey: (args: Record<string, unknown>): string | null => {
            const command = typeof args.command === 'string' ? args.command : '';
            if (!command) return null;
            return generateCommandPatternKey(command);
        },

        suggestApprovalPatterns: (args: Record<string, unknown>): string[] => {
            const command = typeof args.command === 'string' ? args.command : '';
            if (!command) return [];
            return generateCommandPatternSuggestions(command);
        },

        /**
         * Generate preview for approval UI - shows the command to be executed
         */
        generatePreview: async (input: unknown, _context: ToolExecutionContext) => {
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

        execute: async (input: unknown, context: ToolExecutionContext) => {
            const resolvedProcessService = await getProcessService(context);

            // Input is validated by provider before reaching here
            const { command, description, timeout, run_in_background, cwd } =
                input as BashExecInput;

            // Validate cwd to prevent path traversal
            let validatedCwd: string | undefined = cwd;
            if (cwd) {
                const baseDir =
                    resolvedProcessService.getConfig().workingDirectory || process.cwd();

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
            const result = await resolvedProcessService.executeCommand(command, {
                description,
                timeout,
                runInBackground: run_in_background,
                cwd: validatedCwd,
                // Pass abort signal for cancellation support
                abortSignal: context.abortSignal,
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
