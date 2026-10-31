// The sign-in context for this machine: ~/.dexto/accounts, Dexto's OAuth server and the browser.

import os from 'node:os';
import path from 'node:path';
import * as p from '@clack/prompts';
import { dextoAccounts, dextoCloud, dextoSignIn } from '@dexto/agent-management';
import { getDextoGlobalPath } from '@dexto/core';
import { shouldAttemptBrowserLaunch } from '../../auth/browser-launch.js';
import { DEXTO_PLATFORM_URL, DEXTO_PUBLIC_API_URL } from '../../auth/constants.js';
import { nodeSignInRuntime } from '../../auth/sign-in-runtime.js';
import type { SignInContext } from './sign-in-commands.js';

/** Where results and notes go, and what cancels a sign-in; the terminal's by default. */
export interface SignInIo {
    readonly print: (text: string) => void;
    readonly note: (text: string) => void;
    readonly signal: AbortSignal;
}

const TERMINAL: SignInIo = {
    print: (text) => process.stdout.write(`${text}\n`),
    note: (text) => process.stderr.write(`${text}\n`),
    signal: new AbortController().signal,
};

/** The folder the internal `dexto-cloud` CLI saved its sign-ins in. */
function cloudCliDirectory(): string {
    const configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
    return path.join(configHome, 'dexto-cloud');
}

export async function nodeSignInContext(io: SignInIo = TERMINAL): Promise<SignInContext> {
    const dir = getDextoGlobalPath('accounts');
    await dextoAccounts.carryOverCloudCliLogins(dir, cloudCliDirectory());
    const runtime = { ...nodeSignInRuntime(io.signal), note: io.note };
    return {
        dir,
        environment: process.env,
        appUrl: DEXTO_PLATFORM_URL,
        apiBaseUrl: DEXTO_PUBLIC_API_URL,
        print: io.print,
        note: io.note,
        confirm: async (question) => {
            if (!process.stdin.isTTY) return false;
            const answer = await p.confirm({ message: question, initialValue: false });
            return answer === true;
        },
        canOpenBrowser: shouldAttemptBrowserLaunch(),
        dexto: {
            signInWithBrowser: (input) => dextoSignIn.signInWithBrowser(runtime, input),
            signInWithDevice: (input) => dextoSignIn.signInWithDevice(runtime, input),
            endSignIn: (login) => dextoSignIn.endSignIn(runtime, login),
            refreshSignIn: (login) => dextoSignIn.refreshSignIn(runtime, login),
            listProjects: (login) =>
                dextoCloud.listCloudProjects(runtime.fetch, login.apiBaseUrl, login.accessToken),
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
