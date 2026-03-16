import { resolveAgentPath } from '@dexto/agent-management';
import type { DextoAgent } from '@dexto/core';
import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';
import type { RuntimeCommandRegisterContext } from '../register-context.js';

export function registerRunCommand({
    program,
    cliVersion,
    bootstrapAgentFromGlobalOpts,
}: RuntimeCommandRegisterContext): void {
    program
        .command('run [prompt]')
        .description('Run a single prompt non-interactively (headless mode)')
        .option('-m, --model <model>', 'Specify the LLM model to use for this run')
        .addHelpText(
            'after',
            `
Examples:
  $ dexto run "summarize this repository"
  $ echo "fix lint errors" | dexto run
  $ dexto run - < prompt.txt
`
        )
        .action(
            withAnalytics('run', async (promptArg?: string, runOptions?: { model?: string }) => {
                let agent: DextoAgent | undefined;
                let exitCode = 0;
                let exitReason = 'ok';

                try {
                    const {
                        executeHeadlessRun,
                        printHeadlessAssistantResponse,
                        printHeadlessMcpStartup,
                        printHeadlessRunSummary,
                        resolveHeadlessPrompt,
                        writeFinalMessageToStdout,
                        writeHeadlessError,
                    } = await import('./headless.js');
                    const prompt = await resolveHeadlessPrompt(promptArg);
                    if (prompt.trim().length === 0) {
                        writeHeadlessError('Prompt cannot be empty.');
                        exitCode = 1;
                        exitReason = 'empty-prompt';
                    } else {
                        const bootstrapOptions = runOptions?.model
                            ? { mode: 'headless-run' as const, modelOverride: runOptions.model }
                            : { mode: 'headless-run' as const };
                        agent = await bootstrapAgentFromGlobalOpts(bootstrapOptions);
                        const session = await agent.createSession();

                        const globalOpts = program.opts();
                        const resolvedAgentPath = await resolveAgentPath(
                            globalOpts.agent,
                            globalOpts.autoInstall !== false
                        );

                        printHeadlessRunSummary({
                            agent,
                            sessionId: session.id,
                            prompt,
                            agentPath: resolvedAgentPath,
                            cliVersion,
                        });
                        printHeadlessMcpStartup(agent);

                        const runResult = await executeHeadlessRun(agent, session.id, prompt);

                        if (runResult.finalMessage !== undefined) {
                            printHeadlessAssistantResponse(
                                runResult.finalMessage,
                                runResult.totalTokens
                            );
                            writeFinalMessageToStdout(runResult.finalMessage);
                        } else {
                            writeHeadlessError('No final response was produced.');
                            exitCode = 1;
                            exitReason = 'no-final-response';
                        }

                        if (runResult.fatalError) {
                            exitCode = 1;
                            exitReason = 'fatal-error';
                        }
                    }
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    const errorMessage = err instanceof Error ? err.message : String(err);
                    process.stderr.write(`dexto run failed: ${errorMessage}\n`);
                    exitCode = 1;
                    exitReason = 'error';
                } finally {
                    if (agent) {
                        try {
                            await agent.stop();
                        } catch {
                            // Ignore shutdown errors in headless mode cleanup
                        }
                    }
                }

                safeExit('run', exitCode, exitReason);
            })
        );
}
