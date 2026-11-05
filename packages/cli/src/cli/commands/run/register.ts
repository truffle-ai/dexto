import { handleHeadlessApproval } from '../../approval/headless-approval-handler.js';
import {
    chooseHeadlessOutput,
    describeHeadlessFailure,
    headlessExitCode,
    writeHeadlessResult,
    type HeadlessFailure,
} from './output.js';
import { printFault } from '../../screens/fault.js';
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
                    const format = chooseHeadlessOutput(runOptions, process.stdout.isTTY === true);
                    if (format === null) {
                        process.stderr.write('Pass --json, --stream-json or --text, only one.\n');
                        safeExit('run', 2, 'usage');
                        return;
                    }
                    const human = format === 'text';
                    let agent: DextoAgent | undefined;
                    let sessionId: string | undefined;
                    let result: HeadlessRunResult = {};
                    let failure: HeadlessFailure | null = null;
                    let exitReason = 'ok';

                    try {
                        const {
                            executeHeadlessRun,
                            printHeadlessAssistantResponse,
                            printHeadlessMcpStartup,
                            printHeadlessRunSummary,
                            resolveHeadlessPrompt,
                            writeFinalMessageToStdout,
                        } = await import('./headless.js');
                        const prompt = await resolveHeadlessPrompt(promptArg);
                        if (prompt.trim().length === 0) {
                            failure = {
                                code: 'usage',
                                message: 'Prompt cannot be empty.',
                                fix: null,
                            };
                            exitReason = 'empty-prompt';
                        } else {
                            const bootstrapOptions = runOptions.model
                                ? { mode: 'headless-run' as const, modelOverride: runOptions.model }
                                : { mode: 'headless-run' as const };
                            agent = await bootstrapAgentFromGlobalOpts(bootstrapOptions);
                            const session = await agent.createSession();
                            sessionId = session.id;
                            const approvalAgent = agent;
                            approvalAgent.setApprovalHandler((request) =>
                                handleHeadlessApproval(request, approvalAgent, session.id)
                            );

                            if (human) {
                                const globalOpts = program.opts();
                                printHeadlessRunSummary({
                                    agent,
                                    sessionId: session.id,
                                    prompt,
                                    agentPath: await resolveAgentPath(globalOpts.agent),
                                    cliVersion,
                                });
                                printHeadlessMcpStartup(agent);
                            }

                            result = await executeHeadlessRun(agent, session.id, prompt, format);

                            if (result.fatalError) {
                                failure = describeHeadlessFailure(result.fatalError);
                                exitReason = 'fatal-error';
                            } else if (result.finalMessage === undefined) {
                                failure = {
                                    code: 'failed',
                                    message: 'No final response was produced.',
                                    fix: null,
                                };
                                exitReason = 'no-final-response';
                            }
                            if (human && result.finalMessage !== undefined) {
                                printHeadlessAssistantResponse(result.totalTokens);
                                writeFinalMessageToStdout(result.finalMessage);
                            }
                        }
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        failure = describeHeadlessFailure(
                            err instanceof Error ? err : new Error(String(err))
                        );
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

                    if (format !== 'text')
                        await writeHeadlessResult(format, result, sessionId, failure);
                    else if (failure !== null)
                        printFault({ ...failure, details: null }, [
                            `Error: ${failure.message}`,
                            ...(failure.fix === null ? [] : [`Run: ${failure.fix}`]),
                        ]);
                    safeExit('run', headlessExitCode(failure), exitReason);
                }
            )
        );
}
