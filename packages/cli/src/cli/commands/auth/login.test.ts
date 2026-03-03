import { describe, expect, it } from 'vitest';
import { handleLoginCommand } from './login.js';

describe('handleLoginCommand', () => {
    it('throws when --api-key and --token are both provided', async () => {
        await expect(
            handleLoginCommand({
                apiKey: 'dexto_test_key',
                token: 'supabase_test_token',
            })
        ).rejects.toThrow('Cannot use both --api-key and --token. Choose one.');
    });
});
