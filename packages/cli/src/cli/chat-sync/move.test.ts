import { expect, it, vi } from 'vitest';
import { createCloudClient } from '@dexto/cloud-client';
import {
    moveToCloud,
    downloadMoveObject,
    describeObject,
    startLocalReturn,
    waitForMove,
} from './move.js';

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
            repository: '/fake/repository',
            branch: 'main',
            head_commit: 'a'.repeat(40),
            bundle: Buffer.from('bundle'),
            patch: null,
            changedFiles: 0,
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

it('cancels the accepted cloud start whose response was lost and restarts its upload', async () => {
    let starts = 0;
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
        const request =
            input instanceof globalThis.Request ? input : new globalThis.Request(input, init);
        const route = new URL(request.url).pathname;
        calls.push(`${request.method} ${route}`);
        if (route.endsWith('/cancel'))
            return Response.json({ id: 'lost', to: 'cloud', status: 'canceled' });
        if (request.method === 'GET')
            return Response.json({ id: 'lost', to: 'cloud', status: 'awaiting_upload' });
        if (request.method === 'PUT') return new Response(null);
        if (route.endsWith('/uploaded'))
            return Response.json({ id: 'new', to: 'cloud', status: 'completed' });
        starts += 1;
        if (starts === 1) throw new TypeError('accepted response lost');
        if (starts === 2)
            return Response.json(
                {
                    error: {
                        code: 'move_in_progress',
                        message: 'open move',
                        details: { move_id: 'lost' },
                    },
                },
                { status: 409 }
            );
        return Response.json({
            id: 'new',
            to: 'cloud',
            status: 'awaiting_upload',
            uploads: [{ object: 'bundle', url: 'https://upload.invalid/bundle', headers: {} }],
        });
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
    const tree = {
        repository: '/fake/repository',
        branch: 'main',
        head_commit: 'a'.repeat(40),
        bundle: Buffer.from('fake bundle'),
        patch: null,
        changedFiles: 0,
        cleanup: async () => undefined,
    };
    await expect(moveToCloud(transport, 'chat', tree)).rejects.toThrow('accepted response lost');
    await expect(moveToCloud(transport, 'chat', tree)).resolves.toBeUndefined();
    expect(calls).toEqual([
        'POST /v1/synced_chats/chat/moves',
        'POST /v1/synced_chats/chat/moves',
        'GET /v1/synced_chats/chat/moves/lost',
        'POST /v1/synced_chats/chat/moves/lost/cancel',
        'POST /v1/synced_chats/chat/moves',
        'PUT /bundle',
        'POST /v1/synced_chats/chat/moves/new/uploaded',
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
                repository: '/fake/repository',
                branch: 'main',
                head_commit: 'a'.repeat(40),
                bundle: Buffer.from('bundle'),
                patch: null,
                changedFiles: 0,
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
                repository: '/fake/repository',
                branch: 'main',
                head_commit: 'a'.repeat(40),
                bundle: Buffer.from('bundle'),
                patch: null,
                changedFiles: 0,
                cleanup: async () => undefined,
            }
        )
    ).rejects.toMatchObject({ ownership: 'unknown' });
});

it('retries transient polling with Retry-After and judges expiry using server time', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2100-01-01T00:00:00Z'));
    let polls = 0;
    const delays: number[] = [];
    const fetch: typeof globalThis.fetch = async () => {
        polls += 1;
        if (polls === 1) throw new TypeError('temporary disconnect');
        if (polls === 2)
            return Response.json(
                { error: { code: 'rate_limited', message: 'wait' } },
                {
                    status: 429,
                    headers: { 'Retry-After': '3', Date: 'Fri, 06 Nov 2026 00:00:00 GMT' },
                }
            );
        return Response.json(
            { id: 'move', status: 'completed' },
            { headers: { Date: 'Fri, 06 Nov 2026 00:00:03 GMT' } }
        );
    };
    const client = createCloudClient({
        apiBaseUrl: 'https://api.invalid',
        token: 'fake',
        cloudProject: null,
        fetch,
    });
    const transport = {
        client,
        fetch,
        signal: new AbortController().signal,
        sleep: async (ms: number) => {
            delays.push(ms);
        },
    };
    try {
        const initial = {
            id: 'move',
            chat_id: 'chat',
            object: 'synced_chat_move',
            to: 'local',
            status: 'exporting',
            created_at: '2026-11-06T00:00:00Z',
            expires_at: '2026-11-06T01:00:00Z',
            failure: null,
            uploads: [],
            export: null,
        } satisfies import('./move.js').ChatMove;
        await expect(waitForMove(transport, 'chat', initial)).resolves.toMatchObject({
            status: 'completed',
        });
        expect(polls).toBe(3);
        expect(delays).toEqual([2_000, 2_000, 3_000]);
    } finally {
        clock.mockRestore();
    }
});

it.each(['upload', 'polling'] as const)(
    'still sends the cancellation when the person aborts during %s',
    async (stage) => {
        const controller = new AbortController();
        const calls: string[] = [];
        const fetch: typeof globalThis.fetch = async (input, init) => {
            const request =
                input instanceof globalThis.Request ? input : new globalThis.Request(input, init);
            const route = new URL(request.url).pathname;
            calls.push(`${request.method} ${route}`);
            if (stage === 'upload' && request.method === 'PUT') controller.abort();
            // Like the real fetch, refuse any request whose signal was already aborted.
            request.signal.throwIfAborted();
            if (request.method === 'PUT') return new Response(null);
            if (route.endsWith('/cancel'))
                return Response.json({ id: 'm', to: 'cloud', status: 'canceled' });
            if (route.endsWith('/uploaded'))
                return Response.json({
                    id: 'm',
                    to: 'cloud',
                    status: 'importing',
                    expires_at: '2099-01-01T00:00:00Z',
                });
            return Response.json({
                id: 'm',
                to: 'cloud',
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
                {
                    client,
                    fetch,
                    signal: controller.signal,
                    sleep: async () => {
                        controller.abort();
                    },
                },
                'chat',
                {
                    repository: '/fake/repository',
                    branch: 'main',
                    head_commit: 'a'.repeat(40),
                    bundle: Buffer.from('bundle'),
                    patch: null,
                    changedFiles: 0,
                    cleanup: async () => undefined,
                }
            )
        ).rejects.toMatchObject({ name: 'CloudMoveFailure', ownership: 'local' });
        expect(calls).toEqual([
            'POST /v1/synced_chats/chat/moves',
            'PUT /bundle',
            ...(stage === 'polling'
                ? [
                      'POST /v1/synced_chats/chat/moves/m/uploaded',
                      'GET /v1/synced_chats/chat/moves/m',
                  ]
                : []),
            'POST /v1/synced_chats/chat/moves/m/cancel',
        ]);
    }
);
