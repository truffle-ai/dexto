import { describe, expect, it, vi } from 'vitest';
import { requireConfirmation } from './interaction.js';

describe('non-interactive confirmation', () => {
    it('fails with the missing flag without asking when non-interactive', async () => {
        const prompt = vi.fn(async () => true);
        await expect(
            requireConfirmation({
                yes: false,
                interactive: false,
                prompt,
                message: 'Delete?',
                fix: 'dexto delete --yes',
            })
        ).rejects.toMatchObject({
            kind: 'needs_confirmation',
            message: 'Delete? Run it again with --yes once your person has agreed.',
            fix: 'dexto delete --yes',
        });
        expect(prompt).not.toHaveBeenCalled();
    });
});

it('does not ask after explicit confirmation', async () => {
    const prompt = vi.fn(async () => false);
    await expect(
        requireConfirmation({
            yes: true,
            interactive: true,
            prompt,
            message: 'Delete?',
            fix: 'dexto delete --yes',
        })
    ).resolves.toBeUndefined();
    expect(prompt).not.toHaveBeenCalled();
});

it('honors a declined interactive confirmation', async () => {
    await expect(
        requireConfirmation({
            yes: false,
            interactive: true,
            prompt: async () => false,
            message: 'Delete?',
            fix: 'dexto delete --yes',
        })
    ).rejects.toMatchObject({ kind: 'needs_confirmation', message: 'Not done.' });
});

it('names the required flag when a prompt cannot be shown', async () => {
    const { requireInteractive } = await import('./interaction.js');
    expect(() => requireInteractive(false, '--select')).toThrow(
        'Pass --select when running non-interactively.'
    );
});
