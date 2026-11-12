import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublished } from './cli-beta-registry.mjs';

test('only a confirmed missing version permits publication', async () => {
    assert.equal(
        await isPublished(
            'dexto',
            '2.0.0-beta.5',
            async () => new globalThis.Response('', { status: 404 })
        ),
        false
    );
    for (const status of [401, 403, 429, 500, 503]) {
        await assert.rejects(
            isPublished(
                'dexto',
                '2.0.0-beta.5',
                async () => new globalThis.Response('', { status })
            )
        );
    }
    await assert.rejects(
        isPublished('dexto', '2.0.0-beta.5', async () => {
            throw new Error('offline');
        })
    );
    await assert.rejects(
        isPublished('dexto', '2.0.0-beta.5', async () => globalThis.Response.json({}))
    );
    assert.equal(
        await isPublished('dexto', '2.0.0-beta.5', async () =>
            globalThis.Response.json({ name: 'dexto', version: '2.0.0-beta.5' })
        ),
        true
    );
});
