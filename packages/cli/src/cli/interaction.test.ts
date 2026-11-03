import { describe, expect, it, vi } from 'vitest';
import { requireConsent, requireInteractive } from './interaction.js';

describe('non-interactive confirmation', () => {
    it('names the missing flag and gives the exact rerun when input is unavailable', async () => {
        await expect(
            requireConsent(
                { invocation: ['delete', 'a b'], runtime: { prompt: null } },
                false,
                'Delete?'
            )
        ).rejects.toMatchObject({
            kind: 'needs_confirmation',
            message: 'Delete? Run it again with --yes once your person has agreed.',
            fix: "dexto delete 'a b' --yes",
        });
    });
    it('does not ask after explicit confirmation', async () => {
        const prompt = vi.fn(async () => 'no');
        await expect(
            requireConsent({ invocation: [], runtime: { prompt } }, true, 'Delete?')
        ).resolves.toBeUndefined();
        expect(prompt).not.toHaveBeenCalled();
    });
    it('honors a declined interactive confirmation', async () => {
        await expect(
            requireConsent(
                { invocation: [], runtime: { prompt: async () => 'no' } },
                false,
                'Delete?'
            )
        ).rejects.toMatchObject({ kind: 'needs_confirmation', message: 'Not done.' });
    });
    it('names the required flag when a prompt cannot be shown', () => {
        expect(() => requireInteractive(false, '--select')).toThrow(
            'Pass --select when running non-interactively.'
        );
    });
});
