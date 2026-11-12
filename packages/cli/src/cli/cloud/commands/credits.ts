// Credit checkout is a hosted payment: the CLI starts once and only retries status reads.
import { CloudApiError } from '@dexto/cloud-client';
import { safeJson } from '@dexto/tui/signal-text';
import { z } from 'zod';
import { CommandFailure } from '../../failure.js';
import { requireConsent } from '../../interaction.js';
import {
    argument,
    flag,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
    type CommandInput,
} from '../command.js';
import { queryWorkspaceTool } from './workspace.js';
import { reportError } from '../run.js';

const CheckoutSchema = z.object({
    topupId: z.string(),
    checkoutUrl: z.string(),
    expiresAt: z.string(),
    status: z.enum(['open', 'paid', 'failed', 'expired']),
    balanceUsd: z.number().optional(),
    lastFailureReason: z.string().nullable().optional(),
});
type Checkout = z.output<typeof CheckoutSchema>;
const TIMEOUT = {
    timeout: {
        type: 'string',
        valueName: 'SECONDS',
        description: 'Stop waiting after this many seconds.',
    },
} as const;

function deadline(input: CommandInput): number {
    const value = stringOption(input, 'timeout');
    if (value === undefined) return Infinity;
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0)
        throw new UsageError('--timeout must be a nonnegative number of seconds.');
    return Date.now() + seconds * 1000;
}
function show(context: CommandContext, checkout: Checkout, stream: boolean): void {
    if (context.output.json && stream) context.runtime.writeOutput(`${safeJson(checkout, 0)}\n`);
    else
        context.output.result(
            checkout,
            checkout.status === 'paid'
                ? `Paid. Balance $${checkout.balanceUsd?.toFixed(2) ?? 'unknown'}.`
                : `Top-up ${checkout.topupId}: ${checkout.status}\n${checkout.checkoutUrl}\nExpires ${checkout.expiresAt}${checkout.lastFailureReason ? `\nLast attempt failed: ${checkout.lastFailureReason}. The page is still open.` : ''}`
        );
}
async function wait(
    context: CommandContext,
    id: string,
    until: number,
    initial?: Checkout
): Promise<number> {
    const fingerprint = (value: Checkout) =>
        JSON.stringify([value.status, value.lastFailureReason ?? null, value.balanceUsd ?? null]);
    let previous = initial === undefined ? '' : fingerprint(initial);
    let failures = 0;
    let retryBudgetMs = 30_000;
    const resume = `dexto credits topup status ${id} --wait`;
    const report = (error: unknown, fix?: string) =>
        reportError(
            context,
            context.output.json,
            { text: '', command: 'dexto credits topup status --help' },
            error,
            fix
        );
    const timedOut = () =>
        report(
            new CommandFailure('waiting_on_person', 'Timed out waiting for payment.', resume),
            resume
        );
    try {
        for (;;) {
            context.runtime.signal.throwIfAborted();
            const remaining = until - Date.now();
            if (remaining <= 0) return timedOut();
            const read = new AbortController();
            const interrupted = () => read.abort(context.runtime.signal.reason);
            context.runtime.signal.addEventListener('abort', interrupted, { once: true });
            const waitSeconds = Math.min(3, Math.ceil(remaining / 1000));
            const timer = setTimeout(
                () => read.abort(),
                Math.min(remaining, waitSeconds * 1000 + 1500)
            );
            let status: Checkout;
            try {
                status = CheckoutSchema.parse(
                    await queryWorkspaceTool(
                        { ...context, runtime: { ...context.runtime, signal: read.signal } },
                        'dexto_credits_topup_status',
                        { topupId: id, waitSeconds }
                    )
                );
            } catch (error) {
                context.runtime.signal.throwIfAborted();
                const transient =
                    read.signal.aborted ||
                    (error instanceof CloudApiError &&
                        (error.status === 429 || error.status >= 500)) ||
                    (error instanceof Error &&
                        !(error instanceof CommandFailure) &&
                        /network|connection|socket|fetch|ECONN|ETIMEDOUT/iu.test(error.message));
                if (!transient || failures >= 3) throw error;
                const delay = Math.max(
                    500 * 2 ** failures++,
                    error instanceof CloudApiError ? (error.retryAfterSeconds ?? 0) * 1000 : 0
                );
                if (delay >= until - Date.now()) return timedOut();
                if (delay > retryBudgetMs) throw error;
                retryBudgetMs -= delay;
                await context.runtime.sleep(delay);
                continue;
            } finally {
                clearTimeout(timer);
                context.runtime.signal.removeEventListener('abort', interrupted);
            }
            failures = 0;
            retryBudgetMs = 30_000;
            const current = fingerprint(status);
            if (current !== previous) show(context, status, true);
            previous = current;
            if (status.status === 'paid') return 0;
            if (status.status === 'expired') {
                return report(
                    new CommandFailure('failed', 'topup_expired: rerun to get a new link.', null)
                );
            }
            if (status.status === 'failed')
                return report(new CommandFailure('failed', 'Top-up failed.', null));
        }
    } catch (error) {
        if (context.runtime.signal.aborted) {
            report(new CommandFailure('failed', 'Interrupted.', resume), resume);
            return 130;
        }
        return report(error, resume);
    }
}
const balance: Command = {
    path: ['credits', 'balance'],
    summary: 'Read your organization credit balance.',
    examples: ['dexto credits balance --json'],
    jsonOutput: {
        description: 'Current organization credit balance in USD.',
        schema: z.toJSONSchema(z.object({ creditsUsd: z.number() })),
    },
    async run(context) {
        const result = z
            .object({ creditsUsd: z.number() })
            .parse(await queryWorkspaceTool(context, 'dexto_credits_balance', {}));
        context.output.result(result, `Balance $${result.creditsUsd.toFixed(2)}.`);
    },
};
const topup: Command = {
    path: ['credits', 'topup'],
    arguments: '<amount>',
    summary: 'Open a hosted checkout for $5–$500, in $5 increments, and wait for credits.',
    examples: ['dexto credits topup 25 --yes', 'dexto credits topup 25 --yes --no-wait --json'],
    jsonOutput: {
        description: 'Checkout record; waiting emits NDJSON on status changes.',
        schema: z.toJSONSchema(CheckoutSchema),
    },
    options: {
        ...YES_OPTION,
        ...TIMEOUT,
        'no-wait': { type: 'boolean', description: 'Print the checkout and exit without waiting.' },
    },
    async run(context, input) {
        const creditsUsd = Number(argument(input, 0, 'amount'));
        if (
            !Number.isInteger(creditsUsd) ||
            creditsUsd < 5 ||
            creditsUsd > 500 ||
            creditsUsd % 5 !== 0
        )
            throw new UsageError('Amount must be $5 to $500 in $5 increments.');
        const until = deadline(input);
        await requireConsent(
            context,
            flag(input, 'yes'),
            `Add $${creditsUsd} in credits using a hosted payment page.`
        );
        const checkout = CheckoutSchema.parse(
            await queryWorkspaceTool(context, 'dexto_credits_topup', {
                creditsUsd,
                surface: 'cli',
                confirm: true,
            })
        );
        const shouldWait = !flag(input, 'no-wait');
        show(context, checkout, shouldWait);
        if (!shouldWait) return 0;
        if (!context.output.json)
            context.output.note('Waiting for payment. Ctrl-C stops waiting; the link still works.');
        const result = await wait(context, checkout.topupId, until, checkout);
        return result;
    },
};
const status: Command = {
    path: ['credits', 'topup', 'status'],
    arguments: '<id>',
    summary: 'Read or wait for a top-up.',
    examples: ['dexto credits topup status TOPUP_ID --wait --json'],
    jsonOutput: {
        description: 'Checkout record; --wait emits NDJSON on status changes.',
        schema: z.toJSONSchema(CheckoutSchema),
    },
    options: { ...TIMEOUT, wait: { type: 'boolean', description: 'Wait for payment.' } },
    async run(context, input) {
        const id = argument(input, 0, 'id');
        if (flag(input, 'wait')) return wait(context, id, deadline(input));
        const checkout = CheckoutSchema.parse(
            await queryWorkspaceTool(context, 'dexto_credits_topup_status', {
                topupId: id,
                waitSeconds: 0,
            })
        );
        show(context, checkout, false);
        if (checkout.status === 'expired' || checkout.status === 'failed')
            return reportError(
                context,
                context.output.json,
                { text: '', command: 'dexto credits topup status --help' },
                new CommandFailure(
                    'failed',
                    checkout.status === 'expired'
                        ? 'topup_expired: rerun to get a new link.'
                        : 'Top-up failed.',
                    null
                )
            );
        return 0;
    },
};
export const creditCommands: readonly Command[] = [balance, topup, status];
