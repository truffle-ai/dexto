// `login`, `logout`, `whoami`, `accounts`, `models list` and `billing`: who commands act as, and
// the models and credits that sign-in reaches, under the CLI's one output contract.

import { unwrap } from '@dexto/cloud-client';
import {
    argument,
    confirm,
    flag,
    listOption,
    stringOption,
    YES_OPTION,
    type Command,
    type CommandContext,
} from '../command.js';
import type { SignInContext } from '../../commands/auth/sign-in-commands.js';

/** Builds the sign-in context a command runs in; the host owns where sign-ins live. */
export type SignInFor = (io: {
    readonly result: SignInContext['result'];
    readonly note: SignInContext['note'];
    readonly confirm: SignInContext['confirm'];
    readonly signal: AbortSignal;
}) => Promise<SignInContext>;

function signInIo(context: CommandContext) {
    return {
        result: (value: unknown, text: string) => context.output.result(value, text),
        note: (text: string) => context.output.note(text),
        confirm: (question: string) => confirm(context, question),
        signal: context.runtime.signal,
    };
}

export function accountCommands(signIn: SignInFor, creditsUrl: string): readonly Command[] {
    const commands = () => import('../../commands/auth/sign-in-commands.js');
    const login: Command = {
        options: {
            device: {
                description:
                    'Approve a code on any device, for SSH sessions and machines without a browser.',
                type: 'boolean',
            },
            'no-browser': {
                description: 'Print the sign-in link instead of opening it.',
                type: 'boolean',
            },
            org: {
                description:
                    'Sign in for this organization, saved as a profile named after it and used from now on.',
                type: 'string',
                valueName: 'ORG',
            },
            scope: {
                description:
                    'Also ask for a permission, such as drive:write; a first sign-in only reads.',
                multiple: true,
                type: 'string',
                valueName: 'SCOPE',
            },
        },
        path: ['login'],
        summary:
            'Sign in to Dexto with your browser or a device code; --api-key saves a key instead, for CI.',
        async run(context, input) {
            await (
                await commands()
            ).login(await signIn(signInIo(context)), {
                profile: context.overrides.profile,
                org: stringOption(input, 'org') ?? null,
                device: flag(input, 'device'),
                browser: !flag(input, 'no-browser'),
                scopes: listOption(input, 'scope'),
                apiKey: context.overrides.apiKey,
            });
        },
    };

    const logout: Command = {
        path: ['logout'],
        summary: 'End the sign-in on the server and forget it here.',
        async run(context) {
            await (
                await commands()
            ).logout(await signIn(signInIo(context)), { profile: context.overrides.profile });
        },
    };

    const whoami: Command = {
        path: ['whoami'],
        summary: 'Show who Dexto commands act as: the profile, account, organization and project.',
        async run(context) {
            await (
                await commands()
            ).whoami(await signIn(signInIo(context)), {
                profile: context.overrides.profile,
                apiKey: context.overrides.apiKey,
            });
        },
    };

    const accountsList: Command = {
        path: ['accounts', 'list'],
        summary: 'List saved sign-ins, one per account and organization; * marks the one in use.',
        async run(context) {
            await (
                await commands()
            ).listAccounts(await signIn(signInIo(context)), { profile: context.overrides.profile });
        },
    };

    const accountsUse: Command = {
        arguments: '<profile>',
        path: ['accounts', 'use'],
        summary: 'Use this saved sign-in from now on.',
        async run(context, input) {
            await (
                await commands()
            ).useAccount(await signIn(signInIo(context)), argument(input, 0, 'profile'));
        },
    };

    const accountsRemove: Command = {
        arguments: '<profile>',
        options: YES_OPTION,
        path: ['accounts', 'remove'],
        summary: 'Log a saved sign-in out and forget it here. Asks first.',
        async run(context, input) {
            await (
                await commands()
            ).removeAccount(await signIn(signInIo(context)), argument(input, 0, 'profile'), {
                yes: flag(input, 'yes'),
            });
        },
    };

    const modelsList: Command = {
        path: ['models', 'list'],
        summary: 'List the models Dexto serves on your sign-in, as dexto/<model>.',
        async run(context) {
            const models = await unwrap(await (await context.client()).GET('/v1/models'));
            context.output.list(
                { data: models.data.map((model) => ({ ...model, id: `dexto/${model.id}` })) },
                [
                    { header: 'id', value: (model) => model.id },
                    { header: 'name', value: (model) => model.name },
                    { header: 'context', value: (model) => model.context_window },
                ]
            );
        },
    };

    const billing: Command = {
        options: {
            buy: { description: 'Open the page to buy Dexto credits.', type: 'boolean' },
        },
        path: ['billing'],
        summary: "Show the organization's credit balance and recent spending.",
        async run(context, input) {
            const summary = await unwrap(await (await context.client()).GET('/v1/billing/summary'));
            context.output.result(
                summary,
                [
                    `$${summary.balance_usd.toFixed(2)} remaining. Buy more with dexto billing --buy.`,
                    `$${summary.last_30_days.total_cost_usd.toFixed(4)} over ${summary.last_30_days.total_usage_events} requests in the last 30 days.`,
                    ...summary.recent_model_usage
                        .slice(0, 5)
                        .map(
                            (usage) =>
                                `  ${new Date(usage.timestamp).toLocaleString()} ${usage.model}: $${usage.cost_usd.toFixed(4)}`
                        ),
                ].join('\n')
            );
            if (flag(input, 'buy')) {
                context.output.note(`Buy credits at ${creditsUrl}`);
                const { openBrowserUrl } = await import('../../auth/browser-launch.js');
                await openBrowserUrl(creditsUrl).catch(() => undefined);
            }
        },
    };

    return [login, logout, whoami, accountsList, accountsUse, accountsRemove, modelsList, billing];
}
