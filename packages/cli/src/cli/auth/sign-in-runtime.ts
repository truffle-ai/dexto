// The Node side of signing in: a loopback redirect listener, the browser and timers.

import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { openBrowserUrl } from './browser-launch.js';
import { dextoSignIn } from '@dexto/agent-management';

type RedirectListener = dextoSignIn.RedirectListener;
type SignInRuntime = dextoSignIn.SignInRuntime;

/**
 * Listens on 127.0.0.1 at any free port for the browser's redirect to `/callback` (RFC 8252), and
 * resolves with its query on the first one. The browser goes on to the app's `/cli/signed-in`
 * page, carrying the OAuth `error`, if any, so a declined sign-in never reads as signed in.
 */
export async function listenForRedirect(appUrl: string): Promise<RedirectListener> {
    let deliver: (params: URLSearchParams) => void = () => undefined;
    const result = new Promise<URLSearchParams>((resolve) => {
        deliver = resolve;
    });
    const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (request.method !== 'GET' || url.pathname !== '/callback') {
            response.writeHead(404).end();
            return;
        }
        const page = new URL('/cli/signed-in', appUrl);
        const error = url.searchParams.get('error');
        if (error !== null) page.searchParams.set('error', error);
        response.writeHead(302, { location: page.toString() }).end();
        deliver(url.searchParams);
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === 'string')
        throw new Error('The sign-in listener has no port.');
    return {
        redirectUri: `http://127.0.0.1:${address.port}/callback`,
        result,
        close: () => {
            server.closeAllConnections();
            server.close();
        },
    };
}

/** Signing in from this process: notes go to stderr so stdout stays for results. */
export function nodeSignInRuntime(signal: AbortSignal): SignInRuntime {
    return {
        fetch: globalThis.fetch,
        signal,
        prompt: (prompt) => process.stderr.write(`${dextoSignIn.signInPromptText(prompt)}\n`),
        openBrowser: async (url) => {
            try {
                await openBrowserUrl(url);
            } catch {
                // The URL was already printed; the person opens it by hand.
            }
        },
        listenForRedirect,
        sleep: (ms) => sleep(ms, undefined, { signal }),
    };
}
