import { expect, it } from 'vitest';
import { createCloudClient } from '@dexto/cloud-client';
import { moveToCloud, downloadMoveObject, describeObject } from './move.js';

it('uploads declared bytes with signed headers before confirming and polling completion', async () => {
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
        const request =
            input instanceof globalThis.Request ? input : new globalThis.Request(input, init);
        calls.push(`${request.method} ${new URL(request.url).pathname}`);
        if (request.method === 'PUT') {
            expect(request.headers.get('x-test')).toBe('signed');
            expect(await request.text()).toBe('bundle');
            return new Response(null, { status: 200 });
        }
        const status =
            calls.length === 1 ? 'awaiting_upload' : calls.length === 3 ? 'importing' : 'completed';
        return Response.json({
            id: 'm',
            status,
            failure: null,
            uploads:
                status === 'awaiting_upload'
                    ? [
                          {
                              object: 'bundle',
                              method: 'PUT',
                              url: 'https://upload.invalid/bundle',
                              headers: { 'x-test': 'signed' },
                          },
                      ]
                    : [],
        });
    };
    const client = createCloudClient({
        apiBaseUrl: 'https://api.invalid',
        token: 'fake',
        cloudProject: null,
        fetch,
    });
    await moveToCloud(
        { client, fetch, signal: new AbortController().signal, sleep: async () => undefined },
        'chat',
        {
            branch: 'main',
            head_commit: 'a'.repeat(40),
            bundle: Buffer.from('bundle'),
            patch: null,
            cleanup: async () => undefined,
        }
    );
    expect(calls).toEqual([
        'POST /v1/synced_chats/chat/moves',
        'PUT /bundle',
        'POST /v1/synced_chats/chat/moves/m/uploaded',
        'GET /v1/synced_chats/chat/moves/m',
    ]);
});

it('refuses oversized or corrupted downloads before applying anything', async () => {
    const transport = {
        client: createCloudClient({
            apiBaseUrl: 'https://api.invalid',
            token: 'fake',
            cloudProject: null,
        }),
        signal: new AbortController().signal,
        sleep: async () => undefined,
        fetch: async () => new Response('too long'),
    };
    await expect(
        downloadMoveObject(transport, {
            url: 'https://download.invalid',
            ...describeObject(Buffer.from('short')),
        })
    ).rejects.toThrow('declared size');
    await expect(
        downloadMoveObject(
            { ...transport, fetch: async () => new Response('wrong') },
            { url: 'https://download.invalid', ...describeObject(Buffer.from('short')) }
        )
    ).rejects.toThrow('checksum');
});
