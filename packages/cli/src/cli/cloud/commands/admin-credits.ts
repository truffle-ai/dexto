// Operator credits have a separate OAuth grant, stored away from ordinary workspace profiles.
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { dextoAccounts } from '@dexto/agent-management';
import { CloudApiError, createCloudClient, unwrap } from '@dexto/cloud-client';
import { z } from 'zod';
import { CommandFailure } from '../../failure.js';
import { rerunWith } from '../../interaction.js';
import {
    argument,
    boundedOption,
    flag,
    requiredOption,
    stringOption,
    UsageError,
    type Command,
    type CommandContext,
} from '../command.js';
import { signInIo, type SignInFor } from './account.js';

const PROFILE = 'default';
const operatorDir = (dir: string) => path.join(dir, 'operator-credits');
const operatorResource = (appUrl: string) =>
    `${appUrl.replace(/\/+$/u, '')}/api/internal/admin/mcp`;

function refuseOverrides(context: CommandContext): void {
    if (context.overrides.apiKey !== null)
        throw new UsageError(
            'Operator credits require an OAuth sign-in; --api-key cannot be used.'
        );
    if (context.overrides.profile !== null)
        throw new UsageError('Operator credits use their own sign-in; omit --profile.');
}

function throwOperatorFailure(error: unknown): never {
    if (error instanceof CloudApiError && error.status === 401)
        throw new CommandFailure('needs_sign_in', error.message, 'dexto admin login --device');
    throw error;
}

async function operatorClient(dir: string, signIn: SignInFor, context: CommandContext) {
    refuseOverrides(context);
    const credential = await dextoAccounts.resolveCredential({
        dir: operatorDir(dir),
        profile: PROFILE,
        apiKey: null,
        environment: {},
        refresh: async (login, signal) =>
            (await signIn(signInIo(context))).dexto.refreshSignIn(login, signal),
    });
    if (
        credential === null ||
        credential.kind !== 'oauth' ||
        credential.login.resource !== operatorResource(credential.login.appUrl) ||
        !credential.login.scopes.includes('admin:credits')
    )
        throw new CommandFailure(
            'needs_sign_in',
            'Operator credit sign-in required.',
            'dexto admin login --device'
        );
    if (
        context.overrides.apiBaseUrl !== null &&
        context.overrides.apiBaseUrl.replace(/\/+$/u, '') !==
            credential.login.apiBaseUrl.replace(/\/+$/u, '')
    )
        throw new UsageError('Sign in again to change the operator API origin.');
    return createCloudClient({
        apiBaseUrl: credential.login.apiBaseUrl,
        cloudProject: null,
        fetch: context.runtime.fetch,
        token: credential.token,
    });
}

export function adminCreditCommands(dir: string, signIn: SignInFor): readonly Command[] {
    const login: Command = {
        path: ['admin', 'login'],
        summary: 'Sign in separately as an operator for credit grants.',
        options: {
            device: { type: 'boolean', description: 'Approve a code on another device.' },
            'no-browser': { type: 'boolean', description: 'Print the authorization link.' },
        },
        examples: ['dexto admin login --device', 'dexto admin login --json'],
        jsonOutput: {
            description: 'The operator account that signed in.',
            schema: z.toJSONSchema(
                z.object({
                    signed_in: z.literal(true),
                    account: z
                        .object({ id: z.string(), email: z.string(), name: z.string() })
                        .nullable(),
                })
            ),
        },
        async run(context, input) {
            refuseOverrides(context);
            const auth = await signIn(signInIo(context));
            const request = {
                appUrl: auth.appUrl,
                apiBaseUrl: context.overrides.apiBaseUrl ?? auth.apiBaseUrl,
                organization: null,
                purpose: 'operator-credits' as const,
            };
            const device = flag(input, 'device') || !auth.interactive || !auth.canOpenBrowser;
            let saved: dextoAccounts.OAuthLogin;
            try {
                saved = device
                    ? await auth.dexto.signInWithDevice(request)
                    : await auth.dexto.signInWithBrowser({
                          ...request,
                          openBrowser: !flag(input, 'no-browser'),
                      });
            } catch (error) {
                auth.screen.settle(false);
                throw error;
            }
            auth.screen.settle(true);
            if (
                saved.resource !== operatorResource(auth.appUrl) ||
                !saved.scopes.includes('admin:credits')
            )
                throw new CommandFailure(
                    'needs_permission',
                    'The sign-in did not grant operator credit access.',
                    'dexto admin login --device'
                );
            await dextoAccounts.writeLogin(operatorDir(dir), PROFILE, saved);
            context.output.result(
                { signed_in: true, account: saved.signedInAs?.account ?? null },
                'Signed in for operator credits. End this separate sign-in with dexto admin logout.'
            );
        },
    };
    const logout: Command = {
        path: ['admin', 'logout'],
        summary: 'End the separate operator credit sign-in.',
        examples: ['dexto admin logout --json'],
        jsonOutput: {
            description: 'Whether the local sign-in was removed and ended on the server.',
            schema: z.toJSONSchema(
                z.object({ logged_out: z.boolean(), ended_on_server: z.boolean() })
            ),
        },
        async run(context) {
            refuseOverrides(context);
            const saved = await dextoAccounts.readLogin(operatorDir(dir), PROFILE);
            let ended = false;
            if (saved?.kind === 'oauth') {
                const auth = await signIn(signInIo(context));
                const result = await auth.dexto.endSignIn(saved);
                ended = result.status === 'ended';
                if (!ended)
                    context.output.note(
                        'The server could not end this sign-in. Sign it out in Settings; it remains valid until then.'
                    );
            }
            const removed = await dextoAccounts.forgetLogin(operatorDir(dir), PROFILE);
            context.output.result(
                { logged_out: removed, ended_on_server: ended },
                removed ? 'Operator sign-in removed.' : 'No operator sign-in.'
            );
        },
    };
    const grant: Command = {
        path: ['admin', 'credits', 'grant'],
        arguments: '<email> <amount>',
        summary: 'Grant an organization up to $100 in credits.',
        options: {
            reason: {
                type: 'string',
                valueName: 'TEXT',
                description: 'Reason recorded in the audit.',
            },
            organization: {
                type: 'string',
                valueName: 'ID',
                description: 'Organization id when the recipient has several.',
            },
            'idempotency-key': {
                type: 'string',
                valueName: 'KEY',
                description: 'Reuse to safely retry this grant.',
            },
            'dry-run': {
                type: 'boolean',
                description: 'Resolve the destination without granting credits.',
            },
        },
        examples: [
            'dexto admin credits grant person@example.com 25 --reason "Test account" --json',
            'dexto admin credits grant person@example.com 25 --reason "Test account" --dry-run',
        ],
        jsonOutput: {
            description: 'Grant id, destination, amount, and balance.',
            schema: z.toJSONSchema(
                z.object({
                    balance_usd: z.number(),
                    credits_usd: z.number(),
                    dry_run: z.boolean(),
                    grant_id: z.string().nullable(),
                    organization_id: z.string(),
                    recipient_id: z.string(),
                })
            ),
        },
        async run(context, input) {
            const email = argument(input, 0, 'email');
            const credits = Number(argument(input, 1, 'amount'));
            const reason = requiredOption(input, 'reason').trim();
            if (
                !Number.isFinite(credits) ||
                credits <= 0 ||
                credits > 100 ||
                Math.abs(credits * 100 - Math.round(credits * 100)) > 1e-8
            )
                throw new UsageError('Amount must be $0.01 to $100 in cents.');
            if (reason.length < 3 || reason.length > 500)
                throw new UsageError('--reason must be 3 to 500 characters.');
            const key = stringOption(input, 'idempotency-key') ?? randomUUID();
            if (key.trim().length === 0 || key.length > 200)
                throw new UsageError('--idempotency-key must be 1 to 200 characters.');
            const dryRun = flag(input, 'dry-run');
            const retry =
                stringOption(input, 'idempotency-key') === undefined
                    ? rerunWith(context, '--idempotency-key', key)
                    : rerunWith(context);
            if (
                !dryRun &&
                !context.output.json &&
                stringOption(input, 'idempotency-key') === undefined
            )
                context.output.note(`If the result is unknown, retry safely: ${retry}`);
            const organization = stringOption(input, 'organization');
            const client = await operatorClient(dir, signIn, context);
            let result;
            try {
                result = await unwrap(
                    await client.POST('/v1/admin/credit_grants', {
                        body: {
                            email,
                            credits_usd: credits,
                            reason,
                            idempotency_key: key,
                            ...(organization === undefined
                                ? {}
                                : { organization_id: organization }),
                            ...(dryRun ? { dry_run: true } : {}),
                        },
                    })
                );
            } catch (error) {
                if (!dryRun && (!(error instanceof CloudApiError) || error.status >= 500))
                    throw new CommandFailure('failed', 'The grant result is unknown.', retry);
                throwOperatorFailure(error);
            }
            context.output.result(
                result,
                dryRun
                    ? `Would grant $${credits.toFixed(2)} to ${result.organization_id}.`
                    : `Granted $${credits.toFixed(2)} to ${result.organization_id}; balance $${result.balance_usd.toFixed(2)}.`
            );
        },
    };
    const list: Command = {
        path: ['admin', 'credits', 'list'],
        summary: 'List manual credit grants.',
        options: {
            after: {
                type: 'string',
                valueName: 'CURSOR',
                description: 'Continue from the previous page.',
            },
            limit: { type: 'string', valueName: 'N', description: 'Return up to 100 grants.' },
        },
        examples: ['dexto admin credits list --json'],
        jsonOutput: {
            description: 'A page of manual credit grants.',
            schema: z.toJSONSchema(
                z.object({
                    data: z.array(
                        z.object({
                            created_at: z.string(),
                            credits_usd: z.number(),
                            grant_id: z.string(),
                            operator_email: z.string(),
                            organization_id: z.string(),
                            reason: z.string(),
                            recipient_email: z.string(),
                        })
                    ),
                    has_more: z.boolean(),
                    next_after: z.string().nullable(),
                    object: z.literal('list'),
                })
            ),
        },
        async run(context, input) {
            const after = stringOption(input, 'after');
            const limit = boundedOption(input, 'limit', 1, 100);
            const result = await unwrap(
                await (
                    await operatorClient(dir, signIn, context)
                ).GET('/v1/admin/credit_grants', {
                    params: {
                        query: {
                            ...(after === undefined ? {} : { after }),
                            ...(limit === undefined ? {} : { limit }),
                        },
                    },
                })
            ).catch(throwOperatorFailure);
            context.output.list(result, [
                { header: 'date', value: (row) => row.created_at },
                { header: 'recipient', value: (row) => row.recipient_email },
                { header: 'amount', value: (row) => `$${row.credits_usd.toFixed(2)}` },
                { header: 'reason', value: (row) => row.reason },
            ]);
        },
    };
    return [login, logout, grant, list];
}
