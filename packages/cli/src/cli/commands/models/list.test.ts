import { describe, expect, it } from 'vitest';
import { listDextoModels } from './list.js';

describe('dexto models list', () => {
    it('lists the models Dexto serves as dexto/<id>', async () => {
        const printed: string[] = [];

        await listDextoModels({
            read: async () => [
                {
                    id: 'anthropic/claude-sonnet-4.5',
                    name: 'Claude Sonnet 4.5',
                    contextWindow: 200000,
                },
                { id: 'openai/gpt-5', name: 'GPT-5', contextWindow: 400000 },
            ],
            print: (text) => printed.push(text),
        });

        expect(printed).toEqual([
            [
                'dexto/anthropic/claude-sonnet-4.5  Claude Sonnet 4.5',
                'dexto/openai/gpt-5                 GPT-5',
            ].join('\n'),
        ]);
    });

    it('needs a sign-in, with exit 3', async () => {
        await expect(
            listDextoModels({ read: async () => null, print: () => undefined })
        ).rejects.toMatchObject({
            exitCode: 3,
            message: 'Not signed in. Run dexto login, or set DEXTO_API_KEY.',
        });
    });
});
