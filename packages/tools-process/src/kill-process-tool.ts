/**
 * Kill Process Tool
 *
 * Internal tool for terminating background processes
 */

import { z } from 'zod';
import { createLocalToolCallHeader, defineTool, truncateForHeader } from '@dexto/core';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import type { ProcessServiceGetter } from './bash-exec-tool.js';

const KillProcessInputSchema = z
    .object({
        process_id: z.string().describe('Process ID of the background process to terminate'),
    })
    .strict();

/**
 * Create the kill_process internal tool
 */
export function createKillProcessTool(
    getProcessService: ProcessServiceGetter
): Tool<typeof KillProcessInputSchema> {
    return defineTool({
        id: 'kill_process',
        description:
            "Terminate a background process started with bash_exec. Sends SIGTERM signal first, then SIGKILL if process doesn't terminate within 5 seconds. Only works on processes started by this agent. Returns success status and whether the process was running. Does not require additional approval (process was already approved when started).",
        inputSchema: KillProcessInputSchema,
        presentation: {
            describeHeader: (input) =>
                createLocalToolCallHeader({
                    title: 'Kill',
                    argsText: truncateForHeader(input.process_id, 80),
                }),
        },
        async execute(input, context: ToolExecutionContext) {
            const resolvedProcessService = await getProcessService(context);

            // Input is validated by provider before reaching here
            const { process_id } = input;

            // Kill process using ProcessService
            await resolvedProcessService.killProcess(process_id);

            // Note: killProcess returns void and doesn't throw if process already stopped
            return {
                success: true,
                process_id,
                message: `Termination signal sent to process ${process_id}`,
            };
        },
    });
}
