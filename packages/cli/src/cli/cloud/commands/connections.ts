import { z } from 'zod';
import { CommandFailure, EXIT_CODES } from '../../failure.js';
import { requireConsent, shellWord } from '../../interaction.js';
import {
    argument,
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
        valueName: 'CODE',
        description: 'Claude authorization code, or pipe the code on stdin with --json.',
    },
    session: { type: 'string', valueName: 'ID', description: 'Reuse a Claude sign-in chat.' },
} satisfies NonNullable<Command['options']>;

function resume(provider: string, attempt: string): string {
    return `dexto connect ${provider} --attempt ${shellWord(attempt)}`;
}
async function showAuthorization(
    context: CommandContext,
    input: CommandInput,
    started: { url: string; code?: string }
): Promise<void> {
    if (!context.output.json)
        context.output.note(
            `${started.url}${started.code === undefined ? '' : `\nCode: ${started.code}`}`
        );
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
        if (attempt === undefined) {
            let sessionId = stringOption(input, 'session');
            for (let tries = 0; tries < 12; tries++) {
                context.runtime.signal.throwIfAborted();
                let started;
                try {
                    started = Start.parse(
                        await queryWorkspaceTool(context, 'dexto_connection_start', {
                            provider: 'claude',
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
                        `dexto connect claude --session ${shellWord(error.data.sessionId)}`
                    );
                }
                if (started.outcome === 'retry') {
                    sessionId = started.sessionId;
                    if (flag(input, 'no-wait') || tries === 11) {
                        const nextCommand = `dexto connect claude --session ${shellWord(sessionId)}`;
                        context.output.result(
                            { ...started, nextCommand },
                            `Computer is warming. Next: ${nextCommand}`
                        );
                        return flag(input, 'no-wait') ? 0 : EXIT_CODES.waiting_on_person;
                    }
                    await context.runtime.sleep(started.retryAfterSeconds * 1000);
                    continue;
                }
                attempt = started.attemptId;
                await showAuthorization(context, input, started);
                if (flag(input, 'no-wait')) {
                    context.output.result(
                        { ...started, nextCommand: `${resume('claude', attempt)} --code <code>` },
                        `Next: ${resume('claude', attempt)} --code <code>`
                    );
                    return 0;
                }
                break;
            }
        }
        if (attempt === undefined) throw new Error('Claude start returned no attempt.');
        if (flag(input, 'no-wait')) {
            context.output.result(
                {
                    outcome: 'started',
                    provider: 'claude',
                    attemptId: attempt,
                    nextCommand: resume('claude', attempt),
                },
                `Next: ${resume('claude', attempt)}`
            );
            return 0;
        }
        let code = stringOption(input, 'code')?.trim();
        if (
            code === undefined &&
            stringOption(input, 'attempt') === undefined &&
            context.runtime.prompt === null
        ) {
            const piped = (await context.runtime.readStdin()).trim();
            if (piped.length > 0) code = piped;
        }
        if (code === undefined && stringOption(input, 'attempt') === undefined) {
            if (!context.output.json && context.runtime.prompt !== null)
                code = (
                    await context.runtime.prompt('Paste Claude authorization code: ', {
                        secret: true,
                    })
                ).trim();
            if (code === undefined || code.length === 0)
                throw new CommandFailure(
                    'waiting_on_person',
                    'Claude needs the authorization code.',
                    `${resume('claude', attempt)} --code <code>`
                );
        }
        if (code?.startsWith('sk-ant-'))
            throw new UsageError('API keys belong in dashboard Settings > Models.');
        let finished;
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
                if (!error.data.retryable || hint === null || tries >= 2)
                    throw new CommandFailure(
                        error.kind,
                        error.message,
                        error.fix ?? resume('claude', attempt)
                    );
                attempt = hint.arguments.attemptId;
                code = undefined;
                await context.runtime.sleep(1000);
            }
        }
        if (finished.outcome === 'connected') {
            context.output.result(finished, 'Claude connected.');
            return 0;
        }
        await showAuthorization(context, input, finished);
        const nextCommand = `${resume('claude', finished.attemptId)} --code <code>`;
        context.output.result({ ...finished, nextCommand }, `Code rejected. Next: ${nextCommand}`);
        return EXIT_CODES.waiting_on_person;
    },
};
const Wait = z.discriminatedUnion('outcome', [
    z.object({ outcome: z.literal('connected'), name: z.string(), nextAction: z.null() }),
    z.object({
        outcome: z.enum(['timeout', 'expired', 'ended']),
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
        if (attempt === undefined) {
            const started = Start.parse(
                await queryWorkspaceTool(context, 'dexto_connection_start', { provider: 'codex' })
            );
            if (started.outcome !== 'started' || started.provider !== 'codex')
                throw new Error('Dexto returned no Codex attempt.');
            attempt = started.attemptId;
            await showAuthorization(context, input, started);
            if (flag(input, 'no-wait')) {
                context.output.result(
                    { ...started, nextCommand: resume('codex', attempt) },
                    `Next: ${resume('codex', attempt)}`
                );
                return 0;
            }
            if (context.output.json) context.runtime.writeOutput(`${JSON.stringify(started)}\n`);
        }
        if (flag(input, 'no-wait')) {
            const result = {
                outcome: 'started',
                provider: 'codex',
                attemptId: attempt,
                nextCommand: resume('codex', attempt),
            };
            context.output.result(result, `Next: ${result.nextCommand}`);
            return 0;
        }
        for (let tries = 0; ; tries++) {
            context.runtime.signal.throwIfAborted();
            const result = Wait.parse(
                await queryWorkspaceTool(context, 'dexto_connection_wait', {
                    provider: 'codex',
                    attemptId: attempt,
                    timeoutSeconds: 25,
                })
            );
            if (result.outcome === 'connected') {
                if (context.output.json) context.runtime.writeOutput(`${JSON.stringify(result)}\n`);
                else context.output.result(result, 'Codex connected.');
                return 0;
            }
            if (result.outcome !== 'timeout' || flag(input, 'no-wait') || tries === 119) {
                const nextCommand =
                    result.outcome === 'timeout' ? resume('codex', attempt) : 'dexto connect codex';
                if (context.output.json)
                    context.runtime.writeOutput(`${JSON.stringify({ ...result, nextCommand })}\n`);
                else
                    context.output.result(
                        { ...result, nextCommand },
                        `${result.outcome}. Next: ${nextCommand}`
                    );
                return EXIT_CODES.waiting_on_person;
            }
            await context.runtime.sleep(1000);
        }
    },
};
const ConnectionRow = z.discriminatedUnion('kind', [
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
    summary: 'List your model connections and subscription sign-ins.',
    async run(context) {
        const result = z
            .object({ connections: z.array(ConnectionRow) })
            .parse(await queryWorkspaceTool(context, 'dexto_connections_list', {}));
        if (context.output.json) return context.output.record(result);
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
    summary: 'Show the status of Claude, Codex or a saved model connection.',
    async run(context, input) {
        const name = argument(input, 0, 'name');
        const row = ConnectionRow.parse(
            await queryWorkspaceTool(context, 'dexto_connection_get', { name })
        );
        const nextCommand =
            row.nextAction !== null && (row.name === 'claude' || row.name === 'codex')
                ? `dexto connect ${row.name}`
                : `dexto connections status ${shellWord(row.name)}`;
        context.output.record({ ...row, ...(row.status === 'connected' ? {} : { nextCommand }) });
        return row.status === 'connected' ? 0 : EXIT_CODES.waiting_on_person;
    },
};
const disconnect: Command = {
    path: ['connections', 'disconnect'],
    arguments: '<name>',
    options: YES_OPTION,
    summary: 'Disconnect a subscription sign-in. API keys stay dashboard-managed.',
    async run(context, input) {
        const name = argument(input, 0, 'name');
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
        context.output.result(result, `Disconnected ${name}.`);
    },
};
// Keep the server's refusal text and exit kind, with a safe next command for every refusal.
export const connectionCommands: readonly Command[] = [claude, codex, list, status, disconnect].map(
    (command) => ({
        ...command,
        async run(context, input) {
            try {
                return await command.run(context, input);
            } catch (error) {
                if (!(error instanceof CommandFailure) || error.fix !== null) throw error;
                throw new CommandFailure(error.kind, error.message, 'dexto connections list');
            }
        },
    })
);
