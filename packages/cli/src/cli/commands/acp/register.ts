import { inspect } from 'node:util';
import type { RuntimeCommandRegisterContext } from '../register-context.js';

export function registerAcpCommand({
    program,
    cliVersion,
    bootstrapAgentFromGlobalOpts,
}: RuntimeCommandRegisterContext): void {
    program
        .command('acp')
        .description('Serve the Dexto agent over the Agent Client Protocol on stdio (preview)')
        .option('-m, --model <model>', 'Start sessions on this model')
        .addHelpText(
            'after',
            `
Preview: this command and its ACP behaviour may change between releases.
For ACP clients such as T3 Code or Zed: add a local ACP command "dexto" with argument "acp".
Stdout carries only ACP messages; logs go to stderr.
`
        )
        .action(async (options: { model?: string }) => {
            // stdout is the protocol channel: keep stray console output off it.
            console.log = console.error;
            console.info = console.error;
            console.debug = console.error;
            console.dir = (item, options) => console.error(inspect(item, options));
            const { serveAcp } = await import('./acp-agent.js');
            await serveAcp(cliVersion, () =>
                bootstrapAgentFromGlobalOpts({
                    mode: 'acp',
                    ...(options.model ? { modelOverride: options.model } : {}),
                })
            );
            process.exit(0);
        });
}
