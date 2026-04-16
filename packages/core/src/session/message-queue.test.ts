import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageQueueService } from './message-queue.js';
import type { SessionEventBus } from '../events/index.js';
import type { ContentPart } from '../context/types.js';
import { createMockLogger } from '../logger/v2/test-utils.js';
import type { Logger } from '../logger/v2/types.js';
import { createInMemoryMessageQueueStore } from '../test-utils/session-state-stores.js';

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// Create a mock SessionEventBus
function createMockEventBus(): SessionEventBus {
    return {
        emit: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        removeAllListeners: vi.fn(),
    } as unknown as SessionEventBus;
}

describe('MessageQueueService', () => {
    let eventBus: SessionEventBus;
    let logger: Logger;
    let queue: MessageQueueService;

    beforeEach(() => {
        eventBus = createMockEventBus();
        logger = createMockLogger();
        queue = new MessageQueueService(
            eventBus,
            logger,
            'session-1',
            createInMemoryMessageQueueStore()
        );
    });

    describe('enqueue()', () => {
        it('should add a message to the queue and return position and id', async () => {
            const content: ContentPart[] = [{ type: 'text', text: 'hello' }];

            const result = await queue.enqueue({ content });

            expect(result.queued).toBe(true);
            expect(result.position).toBe(1);
            expect(result.id).toMatch(/^msg_\d+_[a-z0-9]+$/);
        });

        it('should increment position for multiple enqueued messages', async () => {
            const content: ContentPart[] = [{ type: 'text', text: 'hello' }];

            const result1 = await queue.enqueue({ content });
            const result2 = await queue.enqueue({ content });
            const result3 = await queue.enqueue({ content });

            expect(result1.position).toBe(1);
            expect(result2.position).toBe(2);
            expect(result3.position).toBe(3);
        });

        it('should emit message:queued event with correct data', async () => {
            const content: ContentPart[] = [{ type: 'text', text: 'hello' }];

            const result = await queue.enqueue({ content });

            expect(eventBus.emit).toHaveBeenCalledWith('message:queued', {
                position: 1,
                id: result.id,
            });
        });

        it('should include metadata when provided', async () => {
            const content: ContentPart[] = [{ type: 'text', text: 'hello' }];
            const metadata = { source: 'api', priority: 'high' };

            await queue.enqueue({ content, metadata });
            const coalesced = await queue.dequeueAll();

            expect(coalesced).not.toBeNull();
            const firstMessage = coalesced?.messages[0];
            expect(firstMessage?.metadata).toEqual(metadata);
        });

        it('should not include metadata field when not provided', async () => {
            const content: ContentPart[] = [{ type: 'text', text: 'hello' }];

            await queue.enqueue({ content });
            const coalesced = await queue.dequeueAll();

            expect(coalesced).not.toBeNull();
            const firstMessage = coalesced?.messages[0];
            expect(firstMessage?.metadata).toBeUndefined();
        });
    });

    describe('dequeueAll()', () => {
        it('should return null when queue is empty', async () => {
            const result = await queue.dequeueAll();
            expect(result).toBeNull();
        });

        it('should return CoalescedMessage with single message', async () => {
            const content: ContentPart[] = [{ type: 'text', text: 'hello' }];
            await queue.enqueue({ content });

            const result = await queue.dequeueAll();

            expect(result).not.toBeNull();
            expect(result?.messages).toHaveLength(1);
            expect(result?.combinedContent).toEqual(content);
        });

        it('should clear the queue after dequeue', async () => {
            await queue.enqueue({ content: [{ type: 'text', text: 'hello' }] });
            await queue.dequeueAll();

            expect(queue.hasPending()).toBe(false);
            expect(queue.pendingCount()).toBe(0);
        });

        it('should emit message:dequeued event with correct data', async () => {
            await queue.enqueue({ content: [{ type: 'text', text: 'msg1' }] });
            await queue.enqueue({ content: [{ type: 'text', text: 'msg2' }] });

            await queue.dequeueAll();

            expect(eventBus.emit).toHaveBeenCalledWith('message:dequeued', {
                count: 2,
                ids: expect.arrayContaining([expect.stringMatching(/^msg_/)]),
                coalesced: true,
                content: expect.any(Array),
                messages: expect.any(Array),
            });
        });

        it('should set coalesced to false for single message', async () => {
            await queue.enqueue({ content: [{ type: 'text', text: 'solo' }] });

            await queue.dequeueAll();

            expect(eventBus.emit).toHaveBeenCalledWith('message:dequeued', {
                count: 1,
                ids: expect.any(Array),
                coalesced: false,
                content: [{ type: 'text', text: 'solo' }],
                messages: expect.any(Array),
            });
        });
    });

    describe('coalescing', () => {
        it('should return single message content as-is', async () => {
            const content: ContentPart[] = [
                { type: 'text', text: 'hello world' },
                { type: 'image', image: 'base64data', mimeType: 'image/png' },
            ];
            await queue.enqueue({ content });

            const result = await queue.dequeueAll();

            expect(result?.combinedContent).toEqual(content);
        });

        it('should prefix two messages with First and Also', async () => {
            await queue.enqueue({ content: [{ type: 'text', text: 'stop' }] });
            await queue.enqueue({ content: [{ type: 'text', text: 'try another way' }] });

            const result = await queue.dequeueAll();

            expect(result?.combinedContent).toHaveLength(3); // First + separator + Also
            expect(result?.combinedContent[0]).toEqual({ type: 'text', text: 'First: stop' });
            expect(result?.combinedContent[1]).toEqual({ type: 'text', text: '\n\n' });
            expect(result?.combinedContent[2]).toEqual({
                type: 'text',
                text: 'Also: try another way',
            });
        });

        it('should number three or more messages', async () => {
            await queue.enqueue({ content: [{ type: 'text', text: 'one' }] });
            await queue.enqueue({ content: [{ type: 'text', text: 'two' }] });
            await queue.enqueue({ content: [{ type: 'text', text: 'three' }] });

            const result = await queue.dequeueAll();

            expect(result?.combinedContent).toHaveLength(5); // 3 messages + 2 separators
            expect(result?.combinedContent[0]).toEqual({ type: 'text', text: '[1]: one' });
            expect(result?.combinedContent[2]).toEqual({ type: 'text', text: '[2]: two' });
            expect(result?.combinedContent[4]).toEqual({ type: 'text', text: '[3]: three' });
        });

        it('should preserve multimodal content (text + images)', async () => {
            await queue.enqueue({
                content: [
                    { type: 'text', text: 'look at this' },
                    { type: 'image', image: 'base64img1', mimeType: 'image/png' },
                ],
            });
            await queue.enqueue({
                content: [{ type: 'image', image: 'base64img2', mimeType: 'image/jpeg' }],
            });

            const result = await queue.dequeueAll();

            // Should have: "First: look at this", image1, separator, "Also: ", image2
            expect(result?.combinedContent).toHaveLength(5);
            expect(result?.combinedContent[0]).toEqual({
                type: 'text',
                text: 'First: look at this',
            });
            expect(result?.combinedContent[1]).toEqual({
                type: 'image',
                image: 'base64img1',
                mimeType: 'image/png',
            });
            expect(result?.combinedContent[3]).toEqual({ type: 'text', text: 'Also: ' });
            expect(result?.combinedContent[4]).toEqual({
                type: 'image',
                image: 'base64img2',
                mimeType: 'image/jpeg',
            });
        });

        it('should tag user messages in mixed batches', async () => {
            await queue.enqueue({ content: [{ type: 'text', text: 'user note' }] });
            await queue.enqueue({
                content: [{ type: 'text', text: 'bg payload' }],
                kind: 'background',
            });

            const result = await queue.dequeueAll();

            expect(result?.combinedContent[0]).toEqual({
                type: 'text',
                text: 'User follow-up 1: user note',
            });
            expect(result?.combinedContent[2]).toEqual({ type: 'text', text: 'bg payload' });
        });

        it('should handle empty message content with placeholder', async () => {
            await queue.enqueue({ content: [{ type: 'text', text: 'first' }] });
            await queue.enqueue({ content: [] });

            const result = await queue.dequeueAll();

            expect(result?.combinedContent).toContainEqual({
                type: 'text',
                text: 'Also: [empty message]',
            });
        });

        it('should set correct firstQueuedAt and lastQueuedAt timestamps', async () => {
            await queue.enqueue({ content: [{ type: 'text', text: 'first' }] });

            // Small delay to ensure different timestamps
            await new Promise((resolve) => setTimeout(resolve, 10));

            await queue.enqueue({ content: [{ type: 'text', text: 'second' }] });

            const result = await queue.dequeueAll();

            expect(result?.firstQueuedAt).toBeLessThan(result?.lastQueuedAt ?? 0);
        });
    });

    describe('hasPending() and pendingCount()', () => {
        it('should return false and 0 for empty queue', () => {
            expect(queue.hasPending()).toBe(false);
            expect(queue.pendingCount()).toBe(0);
        });

        it('should return true and correct count for non-empty queue', async () => {
            await queue.enqueue({ content: [{ type: 'text', text: 'msg1' }] });
            await queue.enqueue({ content: [{ type: 'text', text: 'msg2' }] });

            expect(queue.hasPending()).toBe(true);
            expect(queue.pendingCount()).toBe(2);
        });

        it('should update after dequeue', async () => {
            await queue.enqueue({ content: [{ type: 'text', text: 'msg1' }] });
            expect(queue.pendingCount()).toBe(1);

            await queue.dequeueAll();

            expect(queue.hasPending()).toBe(false);
            expect(queue.pendingCount()).toBe(0);
        });
    });

    describe('initialize()', () => {
        it('should serialize initialization with concurrent queued mutations', async () => {
            const loadStarted = createDeferred<void>();
            const releaseLoad =
                createDeferred<Array<{ id: string; content: ContentPart[]; queuedAt: number }>>();
            const savedQueues: Array<
                Array<{ id: string; content: ContentPart[]; queuedAt: number }>
            > = [];
            const serializedQueue = new MessageQueueService(eventBus, logger, 'session-2', {
                load: vi.fn().mockImplementation(async () => {
                    loadStarted.resolve();
                    return await releaseLoad.promise;
                }),
                save: vi.fn().mockImplementation(async (_sessionId, nextQueue) => {
                    savedQueues.push(structuredClone(nextQueue));
                }),
                delete: vi.fn().mockResolvedValue(undefined),
            });

            const initializePromise = serializedQueue.initialize();
            await loadStarted.promise;

            const enqueuePromise = serializedQueue.enqueue({
                content: [{ type: 'text', text: 'new follow-up' }],
            });

            releaseLoad.resolve([
                {
                    id: 'restored-message',
                    content: [{ type: 'text', text: 'restored follow-up' }],
                    queuedAt: 1,
                },
            ]);

            await initializePromise;
            const enqueued = await enqueuePromise;

            expect(serializedQueue.getAll().map((message) => message.id)).toEqual([
                'restored-message',
                enqueued.id,
            ]);
            expect(savedQueues.at(-1)?.map((message) => message.id)).toEqual([
                'restored-message',
                enqueued.id,
            ]);
        });
    });

    describe('clear()', () => {
        it('should empty the queue', async () => {
            await queue.enqueue({ content: [{ type: 'text', text: 'msg1' }] });
            await queue.enqueue({ content: [{ type: 'text', text: 'msg2' }] });

            await queue.clear();

            expect(queue.hasPending()).toBe(false);
            expect(queue.pendingCount()).toBe(0);
            await expect(queue.dequeueAll()).resolves.toBeNull();
        });
    });

    describe('getAll()', () => {
        it('should return empty array when queue is empty', () => {
            expect(queue.getAll()).toEqual([]);
        });

        it('should return shallow copy of queued messages', async () => {
            const result1 = await queue.enqueue({ content: [{ type: 'text', text: 'msg1' }] });
            const result2 = await queue.enqueue({ content: [{ type: 'text', text: 'msg2' }] });

            const all = queue.getAll();

            expect(all).toHaveLength(2);
            expect(all[0]?.id).toBe(result1.id);
            expect(all[1]?.id).toBe(result2.id);
        });

        it('should not allow external mutation of queue', async () => {
            await queue.enqueue({ content: [{ type: 'text', text: 'msg1' }] });

            const all = queue.getAll();
            all.push({
                id: 'fake',
                content: [{ type: 'text', text: 'fake' }],
                queuedAt: Date.now(),
            });

            expect(queue.getAll()).toHaveLength(1);
        });
    });

    describe('get()', () => {
        it('should return undefined for non-existent id', () => {
            expect(queue.get('non-existent')).toBeUndefined();
        });

        it('should return message by id', async () => {
            const content: ContentPart[] = [{ type: 'text', text: 'hello' }];
            const result = await queue.enqueue({ content });

            const msg = queue.get(result.id);

            expect(msg).toBeDefined();
            expect(msg?.id).toBe(result.id);
            expect(msg?.content).toEqual(content);
        });
    });

    describe('remove()', () => {
        it('should return false for non-existent id', async () => {
            const result = await queue.remove('non-existent');

            expect(result).toBe(false);
            expect(logger.debug).toHaveBeenCalledWith(
                'Remove failed: message non-existent not found in queue'
            );
        });

        it('should remove message and return true', async () => {
            const result = await queue.enqueue({ content: [{ type: 'text', text: 'to remove' }] });

            const removed = await queue.remove(result.id);

            expect(removed).toBe(true);
            expect(queue.get(result.id)).toBeUndefined();
            expect(queue.pendingCount()).toBe(0);
        });

        it('should emit message:removed event', async () => {
            const result = await queue.enqueue({ content: [{ type: 'text', text: 'to remove' }] });

            await queue.remove(result.id);

            expect(eventBus.emit).toHaveBeenCalledWith('message:removed', {
                id: result.id,
            });
        });

        it('should log debug message on successful removal', async () => {
            const result = await queue.enqueue({ content: [{ type: 'text', text: 'to remove' }] });

            await queue.remove(result.id);

            expect(logger.debug).toHaveBeenCalledWith(
                `Message removed: ${result.id}, remaining: 0`
            );
        });

        it('should maintain order of remaining messages', async () => {
            const r1 = await queue.enqueue({ content: [{ type: 'text', text: 'first' }] });
            const r2 = await queue.enqueue({ content: [{ type: 'text', text: 'second' }] });
            const r3 = await queue.enqueue({ content: [{ type: 'text', text: 'third' }] });

            await queue.remove(r2.id);

            const all = queue.getAll();
            expect(all).toHaveLength(2);
            expect(all[0]?.id).toBe(r1.id);
            expect(all[1]?.id).toBe(r3.id);
        });
    });
});
