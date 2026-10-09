import { Option } from 'commander';
import { writeHeadlessResult, type HeadlessOutputFormat } from './output.js';
import type { HeadlessRunResult } from './headless.js';
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
        .addOption(
            new Option('--format <format>', 'Output format')
                .choices(['text', 'json', 'jsonl'])
                .default('text')
        )
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
            withAnalytics(
                'run',
                async (
                    promptArg: string | undefined,
                    runOptions: { model?: string; format: HeadlessOutputFormat }
                ) => {
                    let agent: DextoAgent | undefined;
                    let sessionId: string | undefined;
                    let result: HeadlessRunResult = {};
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
                            result = { fatalError: new Error('Prompt cannot be empty.') };
                            exitCode = 1;
                            exitReason = 'empty-prompt';
                        } else {
                            const bootstrapOptions = runOptions.model
                                ? { mode: 'headless-run' as const, modelOverride: runOptions.model }
                                : { mode: 'headless-run' as const };
                            agent = await bootstrapAgentFromGlobalOpts(bootstrapOptions);
                            const session = await agent.createSession();
                            sessionId = session.id;

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

                            const runResult = await executeHeadlessRun(
                                agent,
                                session.id,
                                prompt,
                                runOptions.format
                            );
                            result = runResult;

                            if (runResult.finalMessage !== undefined) {
                                printHeadlessAssistantResponse(
                                    runResult.finalMessage,
                                    runResult.totalTokens
                                );
                                if (runOptions.format === 'text') {
                                    writeFinalMessageToStdout(runResult.finalMessage);
                                }
                            } else {
                                writeHeadlessError('No final response was produced.');
                                result = {
                                    ...runResult,
                                    fatalError:
                                        runResult.fatalError ??
                                        new Error('No final response was produced.'),
                                };
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
                        result = {
                            fatalError: err instanceof Error ? err : new Error(errorMessage),
                        };
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

                    writeHeadlessResult(runOptions.format, result, sessionId);
                    safeExit('run', exitCode, exitReason);
                }
            )
        );
}
