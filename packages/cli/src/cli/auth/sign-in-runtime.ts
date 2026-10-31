// The Node side of signing in: a loopback redirect listener, the browser and timers.

import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { openBrowserUrl } from './browser-launch.js';
import type { RedirectListener, SignInRuntime } from './sign-in.js';

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Dexto</title>
<body style="font-family:system-ui;margin:4rem auto;max-width:28rem">
<h1>Signed in</h1><p>You can close this tab and return to your terminal.</p></body>`;

/**
 * Listens on 127.0.0.1 at any free port for the browser's redirect to `/callback` (RFC 8252), and
 * resolves with its query on the first one.
 */
export async function listenForRedirect(): Promise<RedirectListener> {
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
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(DONE_PAGE);
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
        note: (text) => process.stderr.write(`${text}\n`),
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
