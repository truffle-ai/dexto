import { describe, expect, it } from 'vitest';
import { showBillingStatus } from './status.js';

describe('dexto billing', () => {
    it('shows the balance, the last 30 days and recent spending', async () => {
        const printed: string[] = [];

        await showBillingStatus({
            read: async () => ({
                balanceUsd: 12.5,
                last30Days: { costUsd: 3.25, usageEvents: 7 },
                recent: [
                    { model: 'openai/gpt-5', costUsd: 0.5, timestamp: '2026-10-31T00:00:00.000Z' },
                ],
            }),
            print: (text) => printed.push(text),
        });

        const text = printed.join('\n');
        expect(text).toContain('$12.50 remaining');
        expect(text).toContain('$3.2500 over 7 requests in the last 30 days');
        expect(text).toContain('openai/gpt-5: $0.5000');
        expect(text).toContain('dexto billing --buy');
    });

    it('needs a sign-in, with exit 3', async () => {
        await expect(
            showBillingStatus({ read: async () => null, print: () => undefined })
        ).rejects.toMatchObject({ exitCode: 3 });
    });
});
