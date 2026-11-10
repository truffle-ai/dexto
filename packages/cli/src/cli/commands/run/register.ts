import { withAnalytics } from '../../../analytics/wrapper.js';
import type { RuntimeCommandRegisterContext } from '../register-context.js';
import { runHeadlessPrompt } from './headless-command.js';

export function registerRunCommand({
    program,
    cliVersion,
    bootstrapAgentFromGlobalOpts,
}: RuntimeCommandRegisterContext): void {
    program
        .command('run [prompt]')
        .description('Run one prompt and print the result')
        .option('-m, --model <model>', 'Specify the LLM model to use for this run')
        .option('--json', 'Print one JSON result (the default when stdout is not a terminal)')
        .option('--stream-json', 'Print JSON events, one per line, ending with one result')
        .option('--text', 'Print only the reply (the default at a terminal)')
        .addHelpText(
            'after',
            `
Examples:
  $ dexto run "summarize this repository"
  $ echo "fix lint errors" | dexto run
  $ dexto run - < prompt.txt
  $ dexto run "list the TODOs" --stream-json

Approvals no one here can give are refused and listed in the result's permission_denials.
Exit codes: 0 done, 1 failed, 2 usage, 3 needs sign-in or permission, 4 needs confirmation,
5 not found, 6 waiting on a person.
`
        )
        .action(
            withAnalytics(
                'run',
                async (
                    promptArg: string | undefined,
                    runOptions: {
                        model?: string;
                        json?: boolean;
                        streamJson?: boolean;
                        text?: boolean;
                    }
                ) => {
                    await runHeadlessPrompt(
                        { program, cliVersion, bootstrapAgentFromGlobalOpts },
                        {
                            command: 'run',
                            options: runOptions,
                            preparePrompt: async () => {
                                const { resolveHeadlessPrompt } = await import('./headless.js');
                                const prompt = await resolveHeadlessPrompt(promptArg);
                                return prompt.trim().length === 0
                                    ? { kind: 'empty' }
                                    : { kind: 'prompt', prompt };
                            },
                        }
                    );
                }
            )
        );
}
