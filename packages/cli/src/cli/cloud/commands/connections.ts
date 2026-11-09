import { z } from 'zod';
import { CommandFailure, EXIT_CODES } from '../../failure.js';
import { requireConsent, shellWord } from '../../interaction.js';
import {
    argument,
    MissingScopeFailure,
    YES_OPTION,
    flag,
    stringOption,
    UsageError,
    type Command,
    type CommandContext,
    type CommandInput,
} from '../command.js';
import { queryWorkspaceTool, WorkspaceToolFailure } from './workspace.js';

const Start = z.discriminatedUnion('outcome', [
    z.object({
        outcome: z.literal('retry'),
        sessionId: z.string(),
        retryAfterSeconds: z.number().nonnegative(),
        nextAction: z.string(),
    }),
    z.discriminatedUnion('provider', [
        z.object({
            outcome: z.literal('started'),
            provider: z.literal('claude'),
            attemptId: z.string(),
            sessionId: z.string(),
            url: z.string().url(),
            expiresAt: z.null(),
            nextAction: z.string(),
        }),
        z.object({
            outcome: z.literal('started'),
            provider: z.literal('codex'),
            attemptId: z.string(),
            url: z.string().url(),
            code: z.string(),
            expiresAt: z.string(),
            pollAfterSeconds: z.number(),
            nextAction: z.string(),
        }),
    ]),
]);
const Finish = z.discriminatedUnion('outcome', [
    z.object({ outcome: z.literal('connected'), name: z.string(), nextAction: z.null() }),
    z.object({
        outcome: z.literal('code_rejected'),
        retryable: z.literal(false).default(false),
        resume: z.null().default(null),
        attemptId: z.string(),
        url: z.string().url(),
        expiresAt: z.null(),
        nextAction: z.string(),
    }),
]);
const connectOptions = {
    'no-browser': {
        type: 'boolean',
        description: 'Print the authorization URL without opening it.',
    },
    'no-wait': { type: 'boolean', description: 'Return the attempt without waiting for approval.' },
    attempt: {
        type: 'string',
        valueName: 'ID',
        description: 'Resume an existing attempt; Claude without --code retries only saving.',
    },
    code: {
        type: 'string',
        valueName: '-',
        description: 'Read a Claude authorization code from stdin with --code -.',
    },
    chat: { type: 'string', valueName: 'ID', description: 'Reuse a Claude sign-in chat.' },
    session: { type: 'string', valueName: 'ID', description: 'Alias for --chat.' },
    console: { type: 'boolean', description: 'Sign in with an Anthropic Console account.' },
} satisfies NonNullable<Command['options']>;

type StartResult = z.output<typeof Start>;
type Started = Extract<StartResult, { outcome: 'started' }>;
type FinishResult = z.output<typeof Finish>;

function resume(provider: string, attempt: string): string {
    return `dexto connect ${shellWord(provider)} --attempt ${shellWord(attempt)}`;
}
function submitCode(attempt: string): string {
    return `${resume('claude', attempt)} --code -`;
}
function writeResult(context: CommandContext, value: unknown, text: string): void {
    if (context.output.json) context.runtime.writeOutput(`${JSON.stringify(value)}\n`);
    else context.output.result(value, text);
}
async function showAuthorization(
    context: CommandContext,
    input: CommandInput,
    started: Started | Extract<FinishResult, { outcome: 'code_rejected' }> | { url: string }
): Promise<void> {
    if (context.output.json) writeResult(context, started, '');
    else context.output.note(`${started.url}${'code' in started ? `\nCode: ${started.code}` : ''}`);
    if (!flag(input, 'no-browser') && !context.output.json) {
        const { openBrowserUrl } = await import('../../auth/browser-launch.js');
        await openBrowserUrl(started.url).catch(() => undefined);
    }
}
const claude: Command = {
    path: ['connect', 'claude'],
    options: connectOptions,
    summary: 'Sign in to Claude Code in Cloud; credentials stay in Cloud.',
    async run(context, input) {
        let attempt = stringOption(input, 'attempt');
        let started: Extract<Started, { provider: 'claude' }> | null = null;
        let code = stringOption(input, 'code')?.trim();
        if (code !== undefined && code !== '-')
            throw new UsageError('Read the authorization code from stdin with --code -.');
        if (attempt === undefined) {
            const chat = stringOption(input, 'chat');
            const session = stringOption(input, 'session');
            if (chat !== undefined && session !== undefined)
                throw new UsageError('Use either --chat or --session.');
            let sessionId = chat ?? session;
            for (let tries = 0; tries < 12; tries++) {
                context.runtime.signal.throwIfAborted();
                let next: StartResult;
                try {
                    next = Start.parse(
                        await queryWorkspaceTool(context, 'dexto_connection_start', {
                            provider: 'claude',
                            ...(flag(input, 'console') ? { method: 'console' } : {}),
                            ...(sessionId === undefined ? {} : { sessionId }),
                        })
                    );
                } catch (error) {
                    if (
                        !(error instanceof WorkspaceToolFailure) ||
                        error.data.sessionId === undefined
                    )
                        throw error;
                    throw new CommandFailure(
                        error.kind,
                        `${error.message} Session: ${error.data.sessionId}.`,
                        error.kind === 'not_found'
                            ? 'dexto connect claude'
                            : `dexto connect claude --chat ${shellWord(error.data.sessionId)}${flag(input, 'console') ? ' --console' : ''}`
                    );
                }
                if (next.outcome === 'retry') {
                    sessionId = next.sessionId;
                    if (flag(input, 'no-wait') || tries === 11) {
                        const nextCommand = `dexto connect claude --chat ${shellWord(sessionId)}${flag(input, 'console') ? ' --console' : ''}`;
                        writeResult(
                            context,
                            { ...next, nextCommand },
                            `Computer is warming. Next: ${nextCommand}`
                        );
                        return flag(input, 'no-wait') ? 0 : EXIT_CODES.waiting_on_person;
                    }
                    await context.runtime.sleep(next.retryAfterSeconds * 1000);
                    continue;
                }
                if (next.provider !== 'claude')
                    throw new Error('Dexto returned no Claude attempt.');
                started = next;
                attempt = next.attemptId;
                await showAuthorization(context, input, started);
                break;
            }
        }
        if (attempt === undefined) throw new Error('Claude start returned no attempt.');
        if (flag(input, 'no-wait')) {
            if (started === null || !context.output.json)
                writeResult(
                    context,
                    {
                        outcome: 'started',
                        provider: 'claude',
                        attemptId: attempt,
                        nextCommand: submitCode(attempt),
                    },
                    `Next: ${submitCode(attempt)}`
                );
            return 0;
        }
        if (code === '-') code = (await context.runtime.readStdin()).trim();
        if (
            code === undefined &&
            started !== null &&
            !context.output.json &&
            context.runtime.prompt !== null
        )
            code = (
                await context.runtime.prompt('Paste Claude authorization code: ', { secret: true })
            ).trim();
        if ((code === undefined && started !== null) || code === '') {
            writeResult(
                context,
                {
                    ...started,
                    outcome: 'code_required',
                    attemptId: attempt,
                    nextCommand: submitCode(attempt),
                },
                `Claude needs the authorization code. Next: ${submitCode(attempt)}`
            );
            return EXIT_CODES.waiting_on_person;
        }
        if (code?.startsWith('sk-ant-'))
            throw new UsageError('API keys belong in dashboard Settings > Models.');
        let finished: FinishResult;
        for (let tries = 0; ; tries++) {
            try {
                finished = Finish.parse(
                    await queryWorkspaceTool(context, 'dexto_connection_finish', {
                        attemptId: attempt,
                        ...(code === undefined ? {} : { code }),
                    })
                );
                break;
            } catch (error) {
                if (!(error instanceof WorkspaceToolFailure)) throw error;
                const hint = error.data.resume;
                if (error.data.retryable && hint !== null) {
                    attempt = hint.arguments.attemptId;
                    if (tries >= 2)
                        throw new CommandFailure(
                            error.kind,
                            error.message,
                            error.fix ?? resume('claude', attempt)
                        );
                    code = undefined;
                    await context.runtime.sleep(1000);
                    continue;
                }
                const sessionId =
                    error.data.sessionId ?? started?.sessionId ?? stringOption(input, 'session');
                const dead = error.data.kind === 'not_found' || error.data.kind === 'invalid_state';
                const fix = dead
                    ? sessionId === undefined
                        ? 'dexto connect claude'
                        : `dexto connect claude --chat ${shellWord(sessionId)}${flag(input, 'console') ? ' --console' : ''}`
                    : submitCode(attempt);
                throw new CommandFailure(error.kind, error.message, error.fix ?? fix);
            }
        }
        if (finished.outcome === 'connected') {
            writeResult(context, finished, 'Claude connected.');
            return 0;
        }
        // A replacement needs a new code, not a save-only retry.
        const nextCommand = submitCode(finished.attemptId);
        if (!context.output.json) await showAuthorization(context, input, finished);
        writeResult(
            context,
            { ...finished, nextCommand },
            `Code rejected. ${finished.url}\nNext: ${nextCommand}`
        );
        return EXIT_CODES.waiting_on_person;
    },
};
const Wait = z.discriminatedUnion('outcome', [
    z.object({ outcome: z.literal('connected'), name: z.string(), nextAction: z.null() }),
    z.object({
        outcome: z.enum([
            'timeout',
            'expired',
            'ended',
            'expired_retry_sign_in',
            'cancelled',
            'failed',
        ]),
        attemptId: z.string(),
        nextAction: z.string(),
    }),
]);
const codex: Command = {
    path: ['connect', 'codex'],
    options: {
        'no-browser': connectOptions['no-browser'],
        'no-wait': connectOptions['no-wait'],
        attempt: connectOptions.attempt,
    },
    summary: 'Sign in to Codex with a device code; credentials stay in Cloud.',
    async run(context, input) {
        let attempt = stringOption(input, 'attempt');
        let started: Extract<Started, { provider: 'codex' }> | null = null;
        let deadline: number | null = null;
        if (attempt === undefined) {
            const next = Start.parse(
                await queryWorkspaceTool(context, 'dexto_connection_start', { provider: 'codex' })
            );
            if (next.outcome !== 'started' || next.provider !== 'codex')
                throw new Error('Dexto returned no Codex attempt.');
            started = next;
            attempt = started.attemptId;
            deadline = Date.parse(started.expiresAt);
            if (!Number.isFinite(deadline))
                throw new Error('Dexto returned an invalid Codex expiry.');
            await showAuthorization(context, input, started);
        }
        if (flag(input, 'no-wait')) {
            const nextCommand = resume('codex', attempt);
            if (started === null || !context.output.json)
                writeResult(
                    context,
                    {
                        ...(started ?? {
                            outcome: 'started',
                            provider: 'codex',
                            attemptId: attempt,
                        }),
                        nextCommand,
                    },
                    `Next: ${nextCommand}`
                );
            return 0;
        }
        for (let tries = 0; ; tries++) {
            context.runtime.signal.throwIfAborted();
            if (deadline !== null && Date.now() >= deadline) {
                writeResult(
                    context,
                    {
                        outcome: 'expired',
                        attemptId: attempt,
                        nextAction: 'dexto_connection_start',
                        nextCommand: 'dexto connect codex',
                    },
                    'Expired. Next: dexto connect codex'
                );
                return EXIT_CODES.failed;
            }
            let waited: z.output<typeof Wait>;
            try {
                waited = Wait.parse(
                    await queryWorkspaceTool(context, 'dexto_connection_wait', {
                        provider: 'codex',
                        attemptId: attempt,
                        timeoutSeconds:
                            deadline === null
                                ? 25
                                : Math.min(
                                      25,
                                      Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
                                  ),
                    })
                );
            } catch (error) {
                if (error instanceof MissingScopeFailure || !(error instanceof CommandFailure))
                    throw error;
                const fix =
                    error.kind === 'not_found' || error.kind === 'invalid_input'
                        ? 'dexto connect codex'
                        : resume('codex', attempt);
                throw new CommandFailure(error.kind, error.message, error.fix ?? fix);
            }
            if (waited.outcome === 'connected') {
                writeResult(context, waited, 'Codex connected.');
                return 0;
            }
            if (waited.outcome === 'expired_retry_sign_in') {
                writeResult(
                    context,
                    { ...waited, nextCommand: 'dexto connect codex' },
                    "Sign-in didn't finish. Run `dexto connect codex` again."
                );
                return EXIT_CODES.failed;
            }
            if (waited.outcome !== 'timeout' || tries === 119) {
                const nextCommand =
                    waited.outcome === 'timeout' ? resume('codex', attempt) : 'dexto connect codex';
                writeResult(
                    context,
                    { ...waited, nextCommand },
                    `${waited.outcome}. Next: ${nextCommand}`
                );
                return waited.outcome === 'timeout'
                    ? EXIT_CODES.waiting_on_person
                    : EXIT_CODES.failed;
            }
            await context.runtime.sleep(
                deadline === null ? 1000 : Math.min(1000, Math.max(0, deadline - Date.now()))
            );
        }
    },
};
const connector: Command = {
    path: ['connect'],
    arguments: '<connector>',
    options: {
        'no-browser': connectOptions['no-browser'],
        'no-wait': connectOptions['no-wait'],
        attempt: connectOptions.attempt,
    },
    summary: 'Connect a catalog service to your cloud account.',
    async run(context, input) {
        const provider = argument(input, 0, 'connector');
        let attempt = stringOption(input, 'attempt');
        let startedHere = false;
        if (attempt === undefined) {
            const started = z
                .discriminatedUnion('outcome', [
                    z.object({
                        outcome: z.literal('started'),
                        provider: z.string(),
                        attemptId: z.string(),
                        url: z.string().url(),
                        nextAction: z.string(),
                    }),
                    z.object({
                        outcome: z.literal('connected'),
                        name: z.string(),
                        nextAction: z.null(),
                    }),
                ])
                .parse(await queryWorkspaceTool(context, 'dexto_connection_start', { provider }));
            if (started.outcome === 'connected') {
                writeResult(context, started, `${provider} connected.`);
                return 0;
            }
            attempt = started.attemptId;
            startedHere = true;
            await showAuthorization(context, input, started);
        }
        if (flag(input, 'no-wait')) {
            if (!context.output.json || !startedHere)
                writeResult(
                    context,
                    {
                        outcome: 'started',
                        provider,
                        attemptId: attempt,
                        nextCommand: resume(provider, attempt),
                    },
                    `Next: ${resume(provider, attempt)}`
                );
            return 0;
        }
        for (let tries = 0; tries < 120; tries++) {
            context.runtime.signal.throwIfAborted();
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 30_000);
            let waited: z.output<typeof Wait>;
            try {
                waited = Wait.parse(
                    await queryWorkspaceTool(
                        {
                            ...context,
                            runtime: {
                                ...context.runtime,
                                signal: AbortSignal.any([
                                    context.runtime.signal,
                                    controller.signal,
                                ]),
                            },
                        },
                        'dexto_connection_wait',
                        { provider, attemptId: attempt }
                    )
                );
            } catch (error) {
                context.runtime.signal.throwIfAborted();
                if (controller.signal.aborted || error instanceof TypeError) {
                    if (tries < 119) {
                        await context.runtime.sleep(1000);
                        continue;
                    }
                }
                const next = resume(provider, attempt);
                if (error instanceof CommandFailure)
                    throw new CommandFailure(
                        error.kind,
                        error.message,
                        `${error.fix === null ? '' : `${error.fix}; then `}${next}`
                    );
                throw new CommandFailure('failed', 'Could not check the connector sign-in.', next);
            } finally {
                clearTimeout(timer);
            }
            if (waited.outcome === 'connected') {
                writeResult(context, waited, `${provider} connected.`);
                return 0;
            }
            if (waited.outcome !== 'timeout') {
                writeResult(context, waited, `Sign-in ${waited.outcome}.`);
                return EXIT_CODES.failed;
            }
            await context.runtime.sleep(1000);
        }
        writeResult(
            context,
            { outcome: 'timeout', attemptId: attempt, nextCommand: resume(provider, attempt) },
            `Next: ${resume(provider, attempt)}`
        );
        return EXIT_CODES.waiting_on_person;
    },
};
const ConnectionRow = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('connector'),
        name: z.string(),
        id: z.string(),
        provider: z.string(),
        status: z.string(),
        nextAction: z.string().nullable(),
    }),
    z.object({
        kind: z.literal('claude_home'),
        name: z.literal('claude'),
        provider: z.literal('claude'),
        status: z.enum(['connected', 'disconnected']),
        available: z.boolean(),
        nextAction: z.string().nullable(),
    }),
    z.object({
        kind: z.literal('codex_status'),
        name: z.literal('codex'),
        status: z.literal('disconnected'),
        nextAction: z.string(),
    }),
    z.object({
        kind: z.literal('model_connection'),
        name: z.string(),
        id: z.string(),
        provider: z.string(),
        authType: z.string(),
        methodId: z.string().nullable(),
        label: z.string().nullable(),
        status: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
        lastTestedAt: z.string().nullable(),
        maskedIdentifier: z.string().nullable(),
        nextAction: z.string().nullable(),
    }),
]);
const list: Command = {
    path: ['connections', 'list'],
    summary: 'List your cloud connections and subscription sign-ins.',
    async run(context) {
        const result = z
            .object({ connections: z.array(ConnectionRow) })
            .parse(await queryWorkspaceTool(context, 'dexto_connections_list', {}));
        if (context.output.json) return writeResult(context, result, '');
        context.output.list({ data: result.connections }, [
            { header: 'name', value: (r) => r.name },
            { header: 'kind', value: (r) => r.kind },
            { header: 'status', value: (r) => r.status },
        ]);
    },
};
const status: Command = {
    path: ['connections', 'status'],
    arguments: '<name>',
    summary: 'Show the status of a cloud connection.',
    async run(context, input) {
        const name = argument(input, 0, 'name');
        const row = ConnectionRow.parse(
            await queryWorkspaceTool(context, 'dexto_connection_get', { name })
        );
        const nextCommand =
            row.kind === 'claude_home'
                ? 'dexto connect claude'
                : row.kind === 'connector'
                  ? `dexto connect ${shellWord(row.name)}`
                  : row.kind === 'codex_status' ||
                      (row.kind === 'model_connection' &&
                          row.authType === 'oauth' &&
                          row.provider === 'openai' &&
                          row.methodId === 'chatgpt_login')
                    ? 'dexto connect codex'
                    : null;
        const fix = nextCommand ?? 'Update it in dashboard Settings > Models';
        writeResult(
            context,
            {
                ...row,
                ...(row.status === 'connected'
                    ? {}
                    : { nextCommand, ...(nextCommand === null ? { fix } : {}) }),
            },
            `${row.name}: ${row.status}${row.status === 'connected' ? '' : `\nNext: ${fix}`}`
        );
        if (row.kind === 'claude_home' && !row.available) return EXIT_CODES.failed;
        return row.status === 'connected'
            ? 0
            : row.nextAction === null
              ? EXIT_CODES.failed
              : EXIT_CODES.waiting_on_person;
    },
};
const disconnect: Command = {
    path: ['connections', 'disconnect'],
    arguments: '<name>',
    options: YES_OPTION,
    summary: 'Disconnect a cloud connection. Model API keys stay dashboard-managed.',
    async run(context, input) {
        const name = argument(input, 0, 'name');
        const connection = ConnectionRow.parse(
            await queryWorkspaceTool(context, 'dexto_connection_get', { name })
        );
        if (
            connection.kind === 'model_connection' &&
            !(
                connection.provider === 'openai' &&
                connection.authType === 'oauth' &&
                connection.methodId === 'chatgpt_login'
            )
        )
            throw new CommandFailure(
                'invalid_input',
                'Only model subscriptions can be disconnected here. Manage API keys and other connections in dashboard Settings > Models.',
                'dexto connections list'
            );
        if (context.output.json && !flag(input, 'yes'))
            throw new CommandFailure(
                'needs_confirmation',
                'Disconnect needs confirmation.',
                `dexto connections disconnect ${shellWord(name)} --yes`
            );
        await requireConsent(
            context,
            flag(input, 'yes'),
            `Disconnect ${name} for future cloud chats.`
        );
        const result = z
            .object({
                outcome: z.literal('disconnected'),
                name: z.string(),
                nextAction: z.string(),
            })
            .parse(await queryWorkspaceTool(context, 'dexto_connection_disconnect', { name }));
        writeResult(context, result, `Disconnected ${name}.`);
    },
};
// Keep the server's refusal text and exit kind, with a safe next command for every refusal.
export const connectionCommands: readonly Command[] = [
    claude,
    codex,
    connector,
    list,
    status,
    disconnect,
].map((command) => ({
    ...command,
    async run(context, input) {
        try {
            return await command.run(context, input);
        } catch (error) {
            if (!(error instanceof CommandFailure) || error.fix !== null) throw error;
            throw new CommandFailure(error.kind, error.message, 'dexto connections list');
        }
    },
}));
