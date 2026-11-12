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
import { safeExit, ExitSignal } from '../../../analytics/wrapper.js';
import type { RuntimeCommandRegisterContext } from '../register-context.js';

/**
 * What a headless command sends the agent: a prompt, nothing because the prompt came out empty
 * (a usage error), or nothing because there is no work, which completes with `message` and never
 * starts an agent.
 */
export type PreparedHeadlessPrompt =
    | { readonly kind: 'prompt'; readonly prompt: string }
    | { readonly kind: 'empty' }
    | { readonly kind: 'no_work'; readonly message: string };

export interface HeadlessPromptOptions {
    readonly model?: string;
    readonly json?: boolean;
    readonly streamJson?: boolean;
    readonly text?: boolean;
}

/**
 * One prompt through a fresh local agent under the `dexto run` contract: --json, --stream-json or
 * --text output, approvals no one here can give refused, and exit codes 0-6. A CommandFailure
 * thrown by `preparePrompt` exits with its own kind and fix.
 */
export async function runHeadlessPrompt(
    { program, cliVersion, bootstrapAgentFromGlobalOpts }: RuntimeCommandRegisterContext,
    {
        command,
        options,
        preparePrompt,
    }: {
        command: string;
        options: HeadlessPromptOptions;
        preparePrompt: () => Promise<PreparedHeadlessPrompt>;
    }
): Promise<void> {
    const format = chooseHeadlessOutput(options, process.stdout.isTTY === true);
    if (format === null) {
        process.stderr.write('Pass --json, --stream-json or --text, only one.\n');
        safeExit(command, 2, 'usage');
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
            writeFinalMessageToStdout,
        } = await import('./headless.js');
        const prepared = await preparePrompt();
        if (prepared.kind === 'empty') {
            failure = { code: 'usage', message: 'Prompt cannot be empty.', fix: null };
            exitReason = 'empty-prompt';
        } else if (prepared.kind === 'no_work') {
            result = { finalMessage: prepared.message };
            exitReason = 'no-work';
            if (human) writeFinalMessageToStdout(prepared.message);
        } else {
            const { prompt } = prepared;
            const bootstrapOptions = options.model
                ? { mode: 'headless-run' as const, modelOverride: options.model }
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
        failure = describeHeadlessFailure(err instanceof Error ? err : new Error(String(err)));
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

    if (format !== 'text') await writeHeadlessResult(format, result, sessionId, failure);
    else if (failure !== null)
        printFault({ ...failure, details: null }, [
            `Error: ${failure.message}`,
            ...(failure.fix === null ? [] : [`Run: ${failure.fix}`]),
        ]);
    safeExit(command, headlessExitCode(failure), exitReason);
}
