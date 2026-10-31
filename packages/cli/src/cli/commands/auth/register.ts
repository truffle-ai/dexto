import os from 'node:os';
import path from 'node:path';
import { Option } from 'commander';
import * as p from '@clack/prompts';
import { getDextoGlobalPath } from '@dexto/core';
import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';
import type { RuntimeCommandRegisterContext } from '../register-context.js';
import { carryOverCloudCliLogins } from '../../auth/accounts.js';
import { DEXTO_PLATFORM_URL, DEXTO_PUBLIC_API_URL } from '../../auth/constants.js';
import {
    endSignIn,
    refreshSignIn,
    signInWithBrowser,
    signInWithDevice,
} from '../../auth/sign-in.js';
import { nodeSignInRuntime } from '../../auth/sign-in-runtime.js';
import { CommandError, type SignInContext } from './sign-in-commands.js';

/** The folder the internal `dexto-cloud` CLI saved its sign-ins in. */
function cloudCliDirectory(): string {
    const configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
    return path.join(configHome, 'dexto-cloud');
}

async function signInContext(): Promise<SignInContext> {
    const dir = getDextoGlobalPath('accounts');
    await carryOverCloudCliLogins(dir, cloudCliDirectory());
    const runtime = nodeSignInRuntime(new AbortController().signal);
    return {
        dir,
        environment: process.env,
        appUrl: DEXTO_PLATFORM_URL,
        apiBaseUrl: DEXTO_PUBLIC_API_URL,
        print: (text) => process.stdout.write(`${text}\n`),
        note: runtime.note,
        confirm: async (question) => {
            if (!process.stdin.isTTY) return false;
            const answer = await p.confirm({ message: question, initialValue: false });
            return answer === true;
        },
        dexto: {
            signInWithBrowser: (input) => signInWithBrowser(runtime, input),
            signInWithDevice: (input) => signInWithDevice(runtime, input),
            endSignIn: (login) => endSignIn(runtime, login),
            refreshSignIn: (login) => refreshSignIn(runtime, login),
            acceptsApiKey: async (apiBaseUrl, apiKey) => {
                const response = await fetch(`${apiBaseUrl}/v1/models`, {
                    headers: { authorization: `Bearer ${apiKey}` },
                    signal: AbortSignal.timeout(10_000),
                });
                await response.body?.cancel();
                if (response.status === 401) return false;
                if (!response.ok)
                    throw new Error(`Couldn't check the API key: HTTP ${response.status}.`);
                return true;
            },
        },
    };
}

/** Runs a sign-in command, mapping its failure to an exit code. */
function action<Args extends unknown[]>(
    name: string,
    run: (context: SignInContext, ...args: Args) => Promise<void>
) {
    return withAnalytics(name, async (...args: Args) => {
        try {
            await run(await signInContext(), ...args);
            safeExit(name, 0);
        } catch (error) {
            if (error instanceof ExitSignal) throw error;
            process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
            safeExit(name, error instanceof CommandError ? error.exitCode : 1, 'error');
        }
    });
}

const profileOption = () =>
    new Option('--profile <name>', 'The saved sign-in to use (or DEXTO_PROFILE)');

export function registerAuthCommand({ program }: RuntimeCommandRegisterContext): void {
    program
        .command('login')
        .description(
            'Sign in to Dexto with your browser or a device code, or save an API key for CI'
        )
        .option('--device', 'Approve a code on any device, for SSH and machines without a browser')
        .option('--no-browser', 'Print the sign-in link instead of opening it')
        .option(
            '--org <org>',
            'Sign in for this organization, saved as a profile named after it and used from now on'
        )
        .option(
            '--scope <scope...>',
            'Also ask for a permission, such as drive:write; a first sign-in only reads'
        )
        .option('--api-key <key>', 'Save a Dexto API key instead of signing in')
        .addOption(profileOption())
        .action(
            action(
                'login',
                async (
                    context,
                    options: {
                        device?: boolean;
                        browser: boolean;
                        org?: string;
                        scope?: string[];
                        apiKey?: string;
                        profile?: string;
                    }
                ) => {
                    const { login } = await import('./sign-in-commands.js');
                    await login(context, {
                        profile: options.profile ?? null,
                        org: options.org ?? null,
                        device: options.device === true,
                        browser: options.browser,
                        scopes: options.scope ?? [],
                        apiKey: options.apiKey ?? null,
                    });
                }
            )
        );

    program
        .command('logout')
        .description('End the sign-in on the server and forget it here')
        .addOption(profileOption())
        .action(
            action('logout', async (context, options: { profile?: string }) => {
                const { logout } = await import('./sign-in-commands.js');
                await logout(context, { profile: options.profile ?? null });
            })
        );

    program
        .command('whoami')
        .description('Show who Dexto commands act as')
        .addOption(profileOption())
        .option('--api-key <key>', 'Check this key instead of the saved sign-in')
        .action(
            action('whoami', async (context, options: { profile?: string; apiKey?: string }) => {
                const { whoami } = await import('./sign-in-commands.js');
                await whoami(context, {
                    profile: options.profile ?? null,
                    apiKey: options.apiKey ?? null,
                });
            })
        );

    const accounts = program
        .command('accounts')
        .description('List, switch and remove saved sign-ins, one per account and organization');

    accounts
        .command('list')
        .description('List saved sign-ins; * marks the one in use')
        .addOption(profileOption())
        .action(
            action('accounts list', async (context, options: { profile?: string }) => {
                const { listAccounts } = await import('./sign-in-commands.js');
                await listAccounts(context, { profile: options.profile ?? null });
            })
        );

    accounts
        .command('use')
        .description('Use this saved sign-in from now on')
        .argument('<profile>')
        .action(
            action('accounts use', async (context, profile: string) => {
                const { useAccount } = await import('./sign-in-commands.js');
                await useAccount(context, profile);
            })
        );

    accounts
        .command('remove')
        .description('Log a saved sign-in out and forget it here. Asks first')
        .argument('<profile>')
        .option('--yes', "Don't ask")
        .action(
            action(
                'accounts remove',
                async (context, profile: string, options: { yes?: boolean }) => {
                    const { removeAccount } = await import('./sign-in-commands.js');
                    await removeAccount(context, profile, { yes: options.yes === true });
                }
            )
        );
}
