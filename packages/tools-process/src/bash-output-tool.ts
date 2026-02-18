/**
 * Bash Output Tool
 *
 * Internal tool for retrieving output from background processes
 */

import { z } from 'zod';
import { defineTool } from '@dexto/core';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import type { ProcessServiceGetter } from './bash-exec-tool.js';

const BashOutputInputSchema = z
    .object({
        process_id: z.string().describe('Process ID from bash_exec (when run_in_background=true)'),
    })
    .strict();

/**
 * Create the bash_output internal tool
 */
export function createBashOutputTool(
    getProcessService: ProcessServiceGetter
): Tool<typeof BashOutputInputSchema> {
    return defineTool({
        id: 'bash_output',
        displayName: 'Bash Output',
        description:
            'Retrieve output from a background process started with bash_exec. Returns stdout, stderr, status (running/completed/failed), exit code, and duration. Each call returns only new output since last read. The output buffer is cleared after reading. Use this tool to monitor long-running commands.',
        inputSchema: BashOutputInputSchema,
        async execute(input, context: ToolExecutionContext) {
            const resolvedProcessService = await getProcessService(context);

            // Input is validated by provider before reaching here
            const { process_id } = input;

            // Get output from ProcessService
            const result = await resolvedProcessService.getProcessOutput(process_id);

            return {
                stdout: result.stdout,
                stderr: result.stderr,
                status: result.status,
                ...(result.exitCode !== undefined && { exit_code: result.exitCode }),
                ...(result.duration !== undefined && { duration: result.duration }),
            };
        },
    });
}
