import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentSignIn, setTuiRuntimeServices, signIn, signOut } from './index.js';

describe('TUI sign-in runtime services', () => {
    afterEach(() => {
        setTuiRuntimeServices({});
    });

    it('signs in, says who, and signs out through the host', async () => {
        const signal = new AbortController().signal;
        const onNote = vi.fn();
        const hostSignIn = vi.fn().mockResolvedValue('Signed in as ada@example.com in Acme.');
        setTuiRuntimeServices({
            currentSignIn: async () => 'ada@example.com in Acme',
            signIn: hostSignIn,
            signOut: async () => 'Logged out.',
        });

        expect(await currentSignIn()).toBe('ada@example.com in Acme');
        expect(await signIn({ signal, onNote })).toBe('Signed in as ada@example.com in Acme.');
        expect(hostSignIn).toHaveBeenCalledWith({ signal, onNote });
        expect(await signOut()).toBe('Logged out.');
    });

    it('fails fast when the host provides no sign-in', async () => {
        await expect(currentSignIn()).rejects.toThrow(
            'TUI runtime services missing required method: currentSignIn'
        );
        await expect(
            signIn({ signal: new AbortController().signal, onNote: () => undefined })
        ).rejects.toThrow('TUI runtime services missing required method: signIn');
        await expect(signOut()).rejects.toThrow(
            'TUI runtime services missing required method: signOut'
        );
    });
});
