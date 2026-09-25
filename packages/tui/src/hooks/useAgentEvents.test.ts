import { createElement } from 'react';
import { PassThrough } from 'stream';
import { render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import type { RestoredPendingInput } from '@dexto/core';
import type { TuiAgentBackend } from '../agent-backend.js';
import type { TextBuffer } from '../components/shared/text-buffer.js';
import { useAgentEvents } from './useAgentEvents.js';

type Listener = (payload: { sessionId?: string; queue?: 'steer' | 'follow-up' }) => void;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function createFakeAgent() {
    const listeners = new Map<string, Set<Listener>>();
    const restoredRequests = new Map<
        string,
        ReturnType<typeof createDeferred<RestoredPendingInput>>
    >();
    const agent = {
        on: (event: string, listener: Listener, options?: { signal?: AbortSignal }) => {
            const set = listeners.get(event) ?? new Set<Listener>();
            set.add(listener);
            listeners.set(event, set);
            options?.signal?.addEventListener('abort', () => set.delete(listener));
        },
        getSteerMessages: vi.fn(async () => []),
        getFollowUpMessages: vi.fn(async () => []),
        getRestoredPendingInput: vi.fn((sessionId: string) => {
            const deferred = createDeferred<RestoredPendingInput>();
            restoredRequests.set(sessionId, deferred);
            return deferred.promise;
        }),
    };
    const emit = (event: string, payload: Parameters<Listener>[0]) => {
        for (const listener of listeners.get(event) ?? []) {
            listener(payload);
        }
    };
    return { agent, emit, restoredRequests };
}

describe('useAgentEvents restored pending input', () => {
    it('drops a restored-input refresh that resolves after switching sessions', async () => {
        const { agent, emit, restoredRequests } = createFakeAgent();
        const setRestoredPendingInput = vi.fn();
        const noop = vi.fn();

        function Harness({ sessionId }: { sessionId: string }) {
            useAgentEvents({
                agent: agent as unknown as TuiAgentBackend,
                setMessages: noop,
                setPendingMessages: noop,
                setUi: noop,
                setSession: noop,
                setInput: noop,
                setApproval: noop,
                setApprovalQueue: noop,
                setSteerMessages: noop,
                setQueuedMessages: noop,
                setRestoredPendingInput,
                currentSessionId: sessionId,
                buffer: { setText: noop } as unknown as TextBuffer,
            });
            return null;
        }

        const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24 });
        const instance = render(createElement(Harness, { sessionId: 'session-a' }), {
            stdout: stdout as unknown as NodeJS.WriteStream,
            debug: true,
            patchConsole: false,
        });
        await flush();

        emit('message:queued', { sessionId: 'session-a', queue: 'follow-up' });
        expect(restoredRequests.has('session-a')).toBe(true);

        instance.rerender(createElement(Harness, { sessionId: 'session-b' }));
        await flush();

        const sessionAInput: RestoredPendingInput = {
            steer: [],
            followUp: [
                {
                    id: 'held-a',
                    content: [{ type: 'text', text: 'from session A' }],
                    queuedAt: 1,
                    kind: 'default',
                },
            ],
        } as unknown as RestoredPendingInput;
        restoredRequests.get('session-a')?.resolve(sessionAInput);
        await flush();

        expect(setRestoredPendingInput).not.toHaveBeenCalledWith(sessionAInput);
        instance.unmount();
    });
});
