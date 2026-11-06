import { expect, it } from 'vitest';
import { createCloudClient } from '@dexto/cloud-client';
import { moveToCloud, downloadMoveObject, describeObject, startLocalReturn } from './move.js';

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

it('recovers the accepted return after losing its start response', async () => {
    let accepted = false;
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
        const request =
            input instanceof globalThis.Request ? input : new globalThis.Request(input, init);
        calls.push(`${request.method} ${new URL(request.url).pathname}`);
        if (request.method === 'POST') {
            if (!accepted) {
                accepted = true;
                throw new Error('start response lost');
            }
            return Response.json(
                {
                    error: {
                        code: 'move_in_progress',
                        message: 'open move',
                        details: { move_id: 'return' },
                    },
                },
                { status: 409 }
            );
        }
        return Response.json({ id: 'return', to: 'local', status: 'exporting' });
    };
    const transport = {
        client: createCloudClient({
            apiBaseUrl: 'https://api.invalid',
            token: 'fake',
            cloudProject: null,
            fetch,
        }),
        fetch,
        signal: new AbortController().signal,
        sleep: async () => undefined,
    };
    await expect(startLocalReturn(transport, 'chat')).rejects.toThrow('start response lost');
    expect(await startLocalReturn(transport, 'chat')).toMatchObject({ id: 'return', to: 'local' });
    expect(calls).toEqual([
        'POST /v1/synced_chats/chat/moves',
        'POST /v1/synced_chats/chat/moves',
        'GET /v1/synced_chats/chat/moves/return',
    ]);
});

it('keeps cloud ownership when cancellation discovers that an interrupted import completed', async () => {
    let canceled = false;
    const fetch: typeof globalThis.fetch = async (input, init) => {
        const request =
            input instanceof globalThis.Request ? input : new globalThis.Request(input, init);
        const route = new URL(request.url).pathname;
        if (request.method === 'PUT') return new Response(null);
        if (request.method === 'GET') throw new Error('final polling response lost');
        if (route.endsWith('/cancel')) {
            canceled = true;
            return Response.json({ id: 'm', status: 'completed' });
        }
        if (route.endsWith('/uploaded'))
            return Response.json({
                id: 'm',
                status: 'importing',
                expires_at: '2099-01-01T00:00:00Z',
            });
        return Response.json({
            id: 'm',
            status: 'awaiting_upload',
            uploads: [{ object: 'bundle', url: 'https://upload.invalid/bundle', headers: {} }],
        });
    };
    const client = createCloudClient({
        apiBaseUrl: 'https://api.invalid',
        token: 'fake',
        cloudProject: null,
        fetch,
    });
    await expect(
        moveToCloud(
            { client, fetch, signal: new AbortController().signal, sleep: async () => undefined },
            'chat',
            {
                branch: 'main',
                head_commit: 'a'.repeat(40),
                bundle: Buffer.from('bundle'),
                patch: null,
                cleanup: async () => undefined,
            }
        )
    ).resolves.toBeUndefined();
    expect(canceled).toBe(true);
});

it('reports unresolved ownership when both polling and cancellation lose the connection', async () => {
    const fetch: typeof globalThis.fetch = async (input, init) => {
        const request =
            input instanceof globalThis.Request ? input : new globalThis.Request(input, init);
        const route = new URL(request.url).pathname;
        if (request.method === 'PUT') return new Response(null);
        if (request.method === 'GET' || route.endsWith('/cancel')) throw new Error('offline');
        if (route.endsWith('/uploaded'))
            return Response.json({
                id: 'm',
                status: 'importing',
                expires_at: '2099-01-01T00:00:00Z',
            });
        return Response.json({
            id: 'm',
            status: 'awaiting_upload',
            uploads: [{ object: 'bundle', url: 'https://upload.invalid/bundle', headers: {} }],
        });
    };
    const client = createCloudClient({
        apiBaseUrl: 'https://api.invalid',
        token: 'fake',
        cloudProject: null,
        fetch,
    });
    await expect(
        moveToCloud(
            { client, fetch, signal: new AbortController().signal, sleep: async () => undefined },
            'chat',
            {
                branch: 'main',
                head_commit: 'a'.repeat(40),
                bundle: Buffer.from('bundle'),
                patch: null,
                cleanup: async () => undefined,
            }
        )
    ).rejects.toMatchObject({ ownership: 'unknown' });
});
