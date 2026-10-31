import { describe, expect, it } from 'vitest';
import { listenForRedirect } from './sign-in-runtime.js';

describe('listenForRedirect', () => {
    it('listens on 127.0.0.1 at /callback and hands back the query', async () => {
        const listener = await listenForRedirect();
        try {
            const uri = new URL(listener.redirectUri);
            expect(uri.hostname).toBe('127.0.0.1');
            expect(uri.pathname).toBe('/callback');
            expect(Number(uri.port)).toBeGreaterThan(0);

            const page = await fetch(`${listener.redirectUri}?code=c1&state=s1`);
            expect(page.status).toBe(200);
            expect(await page.text()).toContain('return to your terminal');
            expect(Object.fromEntries(await listener.result)).toEqual({
                code: 'c1',
                state: 's1',
            });
        } finally {
            listener.close();
        }
    });

    it('answers other paths with 404 and keeps waiting', async () => {
        const listener = await listenForRedirect();
        try {
            const origin = new URL(listener.redirectUri).origin;
            expect((await fetch(`${origin}/favicon.ico`)).status).toBe(404);

            await fetch(`${listener.redirectUri}?error=access_denied&state=s`);
            expect((await listener.result).get('error')).toBe('access_denied');
        } finally {
            listener.close();
        }
    });
});
