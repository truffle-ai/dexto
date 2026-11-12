import { describe, expect, it } from 'vitest';
import { listenForRedirect } from './sign-in-runtime.js';

const APP = 'https://app.dexto.ai';

describe('listenForRedirect', () => {
    it('listens on 127.0.0.1 at /callback, sends the browser to the app and hands back the query', async () => {
        const listener = await listenForRedirect(APP);
        try {
            const uri = new URL(listener.redirectUri);
            expect(uri.hostname).toBe('127.0.0.1');
            expect(uri.pathname).toBe('/callback');
            expect(Number(uri.port)).toBeGreaterThan(0);

            const page = await fetch(`${listener.redirectUri}?code=c1&state=s1`, {
                redirect: 'manual',
            });
            expect(page.status).toBe(302);
            expect(page.headers.get('location')).toBe(`${APP}/cli/signed-in`);
            expect(Object.fromEntries(await listener.result)).toEqual({
                code: 'c1',
                state: 's1',
            });
        } finally {
            listener.close();
        }
    });

    it('forwards the OAuth error to the app page, so a declined sign-in never reads as signed in', async () => {
        const listener = await listenForRedirect(APP);
        try {
            const page = await fetch(
                `${listener.redirectUri}?error=access_denied&error_description=No&state=s`,
                { redirect: 'manual' }
            );
            expect(page.headers.get('location')).toBe(`${APP}/cli/signed-in?error=access_denied`);
            expect((await listener.result).get('error')).toBe('access_denied');
        } finally {
            listener.close();
        }
    });

    it('answers other paths with 404 and keeps waiting', async () => {
        const listener = await listenForRedirect(APP);
        try {
            const origin = new URL(listener.redirectUri).origin;
            expect((await fetch(`${origin}/favicon.ico`)).status).toBe(404);

            await fetch(`${listener.redirectUri}?code=c&state=s`, { redirect: 'manual' });
            expect((await listener.result).get('code')).toBe('c');
        } finally {
            listener.close();
        }
    });
});
