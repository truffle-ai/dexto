/**
 * Bash Output Tool
 *
 * Internal tool for retrieving output from background processes
 */

import { z } from 'zod';
import { InternalTool, ToolExecutionContext } from '@dexto/core';
import { ProcessService } from './process-service.js';

const BashOutputInputSchema = z
    .object({
        process_id: z.string().describe('Process ID from bash_exec (when run_in_background=true)'),
    })
    .strict();

type BashOutputInput = z.input<typeof BashOutputInputSchema>;

/**
 * Create the bash_output internal tool
 */
export function createBashOutputTool(processService: ProcessService): InternalTool {
    return {
        id: 'bash_output',
        description:
            'Retrieve output from a background process started with bash_exec. Returns stdout, stderr, status (running/completed/failed), exit code, and duration. Each call returns only new output since last read. The output buffer is cleared after reading. Use this tool to monitor long-running commands.',
        inputSchema: BashOutputInputSchema,
        execute: async (input: unknown, _context?: ToolExecutionContext) => {
            // Input is validated by provider before reaching here
            const { process_id } = input as BashOutputInput;

            // Get output from ProcessService
            const result = await processService.getProcessOutput(process_id);

            return {
                stdout: result.stdout,
                stderr: result.stderr,
                status: result.status,
                ...(result.exitCode !== undefined && { exit_code: result.exitCode }),
                ...(result.duration !== undefined && { duration: result.duration }),
            };
        },
    };
}
