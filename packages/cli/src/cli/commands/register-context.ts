import type { Command } from 'commander';
import type { DextoAgent } from '@dexto/core';

/**
 * `headless-run` and `acp` are quiet: stdout belongs to the command's output or protocol. `acp`
 * also keeps elicitation on, because its client can answer questions; the other modes have
 * nobody to answer.
 */
export type BootstrapAgentMode = 'headless-run' | 'non-interactive' | 'acp';

export interface RuntimeCommandRegisterContext {
    program: Command;
    cliVersion: string;
    bootstrapAgentFromGlobalOpts: (options: {
        mode: BootstrapAgentMode;
        modelOverride?: string;
    }) => Promise<DextoAgent>;
}
