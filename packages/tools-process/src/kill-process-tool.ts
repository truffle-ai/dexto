/**
 * Kill Process Tool
 *
 * Internal tool for terminating background processes
 */

import { z } from 'zod';
import { InternalTool, ToolExecutionContext } from '@dexto/core';
import { ProcessService } from './process-service.js';

const KillProcessInputSchema = z
    .object({
        process_id: z.string().describe('Process ID of the background process to terminate'),
    })
    .strict();

type KillProcessInput = z.input<typeof KillProcessInputSchema>;

/**
 * Create the kill_process internal tool
 */
export function createKillProcessTool(processService: ProcessService): InternalTool {
    return {
        id: 'kill_process',
        description:
            "Terminate a background process started with bash_exec. Sends SIGTERM signal first, then SIGKILL if process doesn't terminate within 5 seconds. Only works on processes started by this agent. Returns success status and whether the process was running. Does not require additional approval (process was already approved when started).",
        inputSchema: KillProcessInputSchema,
        execute: async (input: unknown, _context?: ToolExecutionContext) => {
            // Input is validated by provider before reaching here
            const { process_id } = input as KillProcessInput;

            // Kill process using ProcessService
            await processService.killProcess(process_id);

            // Note: killProcess returns void and doesn't throw if process already stopped
            return {
                success: true,
                process_id,
                message: `Termination signal sent to process ${process_id}`,
            };
        },
    };
}
