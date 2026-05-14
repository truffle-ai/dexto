import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageQueueService } from './message-queue.js';
import { SessionEventBus } from '../events/index.js';
import type { ContentPart } from '../context/types.js';
import { createMockLogger } from '../logger/v2/test-utils.js';
import type { Logger } from '../logger/v2/types.js';
import { createInMemoryMessageQueueStore } from '../test-utils/session-state-stores.js';
import type { QueuedMessage } from './types.js';

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
                queue: 'steer',
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

        it('should snapshot structured content and metadata on enqueue', async () => {
            const imageBytes = new Uint8Array([1, 2, 3]);
            const imageUrl = new URL('https://example.com/image.png');
            const fileBytes = Buffer.from([4, 5, 6]);
            const fileUrl = new URL('https://example.com/file.pdf');
            const content: ContentPart[] = [
                { type: 'text', text: 'look' },
                { type: 'image', image: imageBytes, mimeType: 'image/png' },
                { type: 'image', image: imageUrl, mimeType: 'image/png' },
                { type: 'file', data: fileBytes, mimeType: 'application/pdf' },
                { type: 'file', data: fileUrl, mimeType: 'application/pdf' },
            ];
            const metadata = { source: 'webui', nested: { editable: true } };

            await queue.enqueue({ content, metadata });
            content[0] = { type: 'text', text: 'mutated' };
            imageBytes[0] = 9;
            imageUrl.pathname = '/mutated.png';
            fileBytes[0] = 9;
            fileUrl.pathname = '/mutated.pdf';
            metadata.nested.editable = false;

            const queued = queue.getAll()[0];
            const queuedUrlPart = queued?.content[2];
            if (queuedUrlPart?.type !== 'image') throw new Error('Expected image URL part');
            if (!(queuedUrlPart.image instanceof URL)) throw new Error('Expected URL clone');
            const queuedFileUrlPart = queued?.content[4];
            if (queuedFileUrlPart?.type !== 'file') throw new Error('Expected file URL part');
            if (!(queuedFileUrlPart.data instanceof URL))
                throw new Error('Expected file URL clone');

            expect(queue.getAll()).toEqual([
                expect.objectContaining({
                    content: [
                        { type: 'text', text: 'look' },
                        { type: 'image', image: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
                        {
                            type: 'image',
                            image: new URL('https://example.com/image.png'),
                            mimeType: 'image/png',
                        },
                        {
                            type: 'file',
                            data: Buffer.from([4, 5, 6]),
                            mimeType: 'application/pdf',
                        },
                        {
                            type: 'file',
                            data: new URL('https://example.com/file.pdf'),
                            mimeType: 'application/pdf',
                        },
                    ],
                    metadata: { source: 'webui', nested: { editable: true } },
                }),
            ]);
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
        it('consumes messages appended to the backing store after initialization', async () => {
            const store = createInMemoryMessageQueueStore();
            const persistedMessage: QueuedMessage = {
                content: [{ type: 'text', text: 'external steer' }],
                id: 'external-1',
                queuedAt: 100,
            };
            const persistedQueue = new MessageQueueService(
                eventBus,
                logger,
                'session-external',
                store
            );

            await persistedQueue.initialize();
            await store.save({ sessionId: 'session-external', queue: [persistedMessage] });

            const coalesced = await persistedQueue.dequeueAll();

            expect(coalesced?.messages).toEqual([persistedMessage]);
            await expect(store.load({ sessionId: 'session-external' })).resolves.toEqual([]);
        });

        it('preserves in-memory and externally appended queue order without duplicating ids', async () => {
            const store = createInMemoryMessageQueueStore();
            const persistedQueue = new MessageQueueService(
                eventBus,
                logger,
                'session-merged',
                store
            );

            await persistedQueue.initialize();
            const enqueued = await persistedQueue.enqueue({
                content: [{ type: 'text', text: 'from live queue' }],
            });
            await store.save({
                sessionId: 'session-merged',
                queue: [
                    {
                        content: [{ type: 'text', text: 'from live queue' }],
                        id: enqueued.id,
                        queuedAt: 100,
                    },
                    {
                        content: [{ type: 'text', text: 'from external route' }],
                        id: 'external-2',
                        queuedAt: Date.now() + 1000,
                    },
                ],
            });

            const coalesced = await persistedQueue.dequeueAll();

            expect(coalesced?.messages.map((message) => message.id)).toEqual([
                enqueued.id,
                'external-2',
            ]);
        });

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
                queue: 'steer',
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
                queue: 'steer',
                coalesced: false,
                content: [{ type: 'text', text: 'solo' }],
                messages: expect.any(Array),
            });
        });

        it('should not let dequeued event listeners mutate the returned message', async () => {
            const realEventBus = new SessionEventBus();
            const eventedQueue = new MessageQueueService(
                realEventBus,
                logger,
                'session-with-events',
                createInMemoryMessageQueueStore()
            );
            realEventBus.on('message:dequeued', (payload) => {
                payload.content.push({ type: 'text', text: 'event mutation' });
                if (!payload.messages) throw new Error('Expected dequeued messages');
                const firstMessagePart = payload.messages[0]?.content[0];
                if (firstMessagePart?.type === 'text') {
                    firstMessagePart.text = 'event-mutated message';
                }
            });

            await eventedQueue.enqueue({ content: [{ type: 'text', text: 'original' }] });
            const result = await eventedQueue.dequeueAll();

            expect(result?.combinedContent).toEqual([{ type: 'text', text: 'original' }]);
            expect(result?.messages[0]?.content).toEqual([{ type: 'text', text: 'original' }]);
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

        it('should combine two user messages with a neutral bullet list', async () => {
            await queue.enqueue({ content: [{ type: 'text', text: 'stop' }] });
            await queue.enqueue({ content: [{ type: 'text', text: 'try another way' }] });

            const result = await queue.dequeueAll();

            expect(result?.combinedContent).toHaveLength(4);
            expect(result?.combinedContent[0]).toEqual({
                type: 'text',
                text: 'Additional user input received:',
            });
            expect(result?.combinedContent[1]).toEqual({ type: 'text', text: '\n\n' });
            expect(result?.combinedContent[2]).toEqual({ type: 'text', text: '- stop' });
            expect(result?.combinedContent[3]).toEqual({
                type: 'text',
                text: '\n\n- try another way',
            });
        });

        it('should combine three or more user messages with neutral bullets', async () => {
            await queue.enqueue({ content: [{ type: 'text', text: 'one' }] });
            await queue.enqueue({ content: [{ type: 'text', text: 'two' }] });
            await queue.enqueue({ content: [{ type: 'text', text: 'three' }] });

            const result = await queue.dequeueAll();

            expect(result?.combinedContent).toHaveLength(5);
            expect(result?.combinedContent[0]).toEqual({
                type: 'text',
                text: 'Additional user input received:',
            });
            expect(result?.combinedContent[2]).toEqual({ type: 'text', text: '- one' });
            expect(result?.combinedContent[3]).toEqual({ type: 'text', text: '\n\n- two' });
            expect(result?.combinedContent[4]).toEqual({ type: 'text', text: '\n\n- three' });
        });

        it('should preserve multimodal content (text + images)', async () => {
            await queue.enqueue({
                metadata: { source: 'preview', nested: { editable: true } },
                content: [
                    { type: 'text', text: 'look at this' },
                    { type: 'image', image: 'base64img1', mimeType: 'image/png' },
                ],
            });
            await queue.enqueue({
                content: [{ type: 'image', image: 'base64img2', mimeType: 'image/jpeg' }],
            });

            const result = await queue.dequeueAll();

            expect(result?.combinedContent).toHaveLength(6);
            expect(result?.combinedContent[0]).toEqual({
                type: 'text',
                text: 'Additional user input received:',
            });
            expect(result?.combinedContent[2]).toEqual({
                type: 'text',
                text: '- look at this',
            });
            expect(result?.combinedContent[3]).toEqual({
                type: 'image',
                image: 'base64img1',
                mimeType: 'image/png',
            });
            expect(result?.combinedContent[4]).toEqual({ type: 'text', text: '\n\n- ' });
            expect(result?.combinedContent[5]).toEqual({
                type: 'image',
                image: 'base64img2',
                mimeType: 'image/jpeg',
            });
        });

        it('should preserve structured content parts while coalescing split queued input', async () => {
            const filePart = {
                type: 'file' as const,
                data: 'base64-pdf',
                mimeType: 'application/pdf',
                filename: 'brief.pdf',
            };
            const resourcePart = {
                type: 'resource' as const,
                uri: 'file:///tmp/chart.png',
                name: 'chart.png',
                mimeType: 'image/png',
                kind: 'image' as const,
                size: 128,
                metadata: { source: 'filesystem' as const, mtimeMs: 123 },
            };
            const uiResourcePart = {
                type: 'ui-resource' as const,
                uri: 'ui://dashboard',
                mimeType: 'text/html',
                content: '<section>Dashboard</section>',
                metadata: { title: 'Dashboard', preferredSize: { width: 640, height: 480 } },
            };

            await queue.enqueue({
                content: [{ type: 'text', text: 'use this brief' }, filePart],
                metadata: { source: 'steer' },
            });
            await queue.enqueue({
                content: [resourcePart, uiResourcePart],
            });

            const result = await queue.dequeueAll();

            expect(result?.combinedContent).toEqual([
                { type: 'text', text: 'Additional user input received:' },
                { type: 'text', text: '\n\n' },
                { type: 'text', text: '- use this brief' },
                filePart,
                { type: 'text', text: '\n\n- ' },
                resourcePart,
                uiResourcePart,
            ]);
            expect(result?.messages[0]?.metadata).toEqual({ source: 'steer' });
        });

        it('should combine user messages neutrally and preserve background payloads in mixed batches', async () => {
            await queue.enqueue({ content: [{ type: 'text', text: 'user note' }] });
            await queue.enqueue({
                content: [{ type: 'text', text: 'bg payload' }],
                kind: 'background',
            });

            const result = await queue.dequeueAll();

            expect(result?.combinedContent).toEqual([
                { type: 'text', text: 'Additional user input received:' },
                { type: 'text', text: '\n\n' },
                { type: 'text', text: '- user note' },
                { type: 'text', text: '\n\n' },
                { type: 'text', text: 'bg payload' },
            ]);
        });

        it('should preserve mixed batch order when background payload comes first', async () => {
            await queue.enqueue({
                content: [{ type: 'text', text: 'bg payload' }],
                kind: 'background',
            });
            await queue.enqueue({ content: [{ type: 'text', text: 'user note' }] });

            const result = await queue.dequeueAll();

            expect(result?.combinedContent).toEqual([
                { type: 'text', text: 'bg payload' },
                { type: 'text', text: '\n\n' },
                { type: 'text', text: 'Additional user input received:' },
                { type: 'text', text: '\n\n' },
                { type: 'text', text: '- user note' },
            ]);
        });

        it('should reopen the user section after background payloads', async () => {
            await queue.enqueue({ content: [{ type: 'text', text: 'first user note' }] });
            await queue.enqueue({
                content: [{ type: 'text', text: 'bg payload' }],
                kind: 'background',
            });
            await queue.enqueue({ content: [{ type: 'text', text: 'second user note' }] });

            const result = await queue.dequeueAll();

            expect(result?.combinedContent).toEqual([
                { type: 'text', text: 'Additional user input received:' },
                { type: 'text', text: '\n\n' },
                { type: 'text', text: '- first user note' },
                { type: 'text', text: '\n\n' },
                { type: 'text', text: 'bg payload' },
                { type: 'text', text: '\n\n' },
                { type: 'text', text: 'Additional user input received:' },
                { type: 'text', text: '\n\n' },
                { type: 'text', text: '- second user note' },
            ]);
        });

        it('should handle empty message content with placeholder', async () => {
            await queue.enqueue({ content: [{ type: 'text', text: 'first' }] });
            await queue.enqueue({ content: [] });

            const result = await queue.dequeueAll();

            expect(result?.combinedContent).toContainEqual({
                type: 'text',
                text: '\n\n- [empty message]',
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
                save: vi.fn().mockImplementation(async (input) => {
                    savedQueues.push(structuredClone(input.queue));
                }),
                delete: vi.fn().mockResolvedValue(undefined),
                listSessionIds: vi.fn().mockResolvedValue([]),
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

        it('should return copies of queued messages', async () => {
            const result1 = await queue.enqueue({ content: [{ type: 'text', text: 'msg1' }] });
            const result2 = await queue.enqueue({ content: [{ type: 'text', text: 'msg2' }] });

            const all = queue.getAll();

            expect(all).toHaveLength(2);
            expect(all[0]?.id).toBe(result1.id);
            expect(all[1]?.id).toBe(result2.id);
        });

        it('should not allow external mutation of queued message arrays or parts', async () => {
            await queue.enqueue({
                metadata: { source: 'preview', nested: { editable: true } },
                content: [
                    { type: 'text', text: 'msg1' },
                    {
                        type: 'resource',
                        uri: 'file:///tmp/chart.png',
                        name: 'chart.png',
                        mimeType: 'image/png',
                        kind: 'image',
                        metadata: { source: 'filesystem' },
                    },
                    {
                        type: 'ui-resource',
                        uri: 'ui://dashboard',
                        mimeType: 'text/html',
                        metadata: { preferredSize: { width: 640, height: 480 } },
                    },
                ],
            });

            const all = queue.getAll();
            all.push({
                id: 'fake',
                content: [{ type: 'text', text: 'fake' }],
                queuedAt: Date.now(),
            });
            all[0]?.content.push({ type: 'text', text: 'extra' });
            const firstPart = all[0]?.content[0];
            if (firstPart?.type !== 'text') throw new Error('Expected text part');
            firstPart.text = 'mutated';
            const resourcePart = all[0]?.content[1];
            if (resourcePart?.type !== 'resource') throw new Error('Expected resource part');
            if (resourcePart.metadata) resourcePart.metadata.source = 'upload';
            const uiResourcePart = all[0]?.content[2];
            if (uiResourcePart?.type !== 'ui-resource')
                throw new Error('Expected UI resource part');
            if (uiResourcePart.metadata?.preferredSize) {
                uiResourcePart.metadata.preferredSize.width = 1;
            }
            const queueMetadata = all[0]?.metadata;
            if (!queueMetadata) throw new Error('Expected queue metadata');
            queueMetadata.source = 'mutated';
            const nestedMetadata = queueMetadata.nested;
            if (
                typeof nestedMetadata !== 'object' ||
                nestedMetadata === null ||
                !('editable' in nestedMetadata)
            ) {
                throw new Error('Expected nested metadata');
            }
            nestedMetadata.editable = false;

            expect(queue.getAll()).toHaveLength(1);
            expect(queue.getAll()[0]?.content).toEqual([
                { type: 'text', text: 'msg1' },
                {
                    type: 'resource',
                    uri: 'file:///tmp/chart.png',
                    name: 'chart.png',
                    mimeType: 'image/png',
                    kind: 'image',
                    metadata: { source: 'filesystem' },
                },
                {
                    type: 'ui-resource',
                    uri: 'ui://dashboard',
                    mimeType: 'text/html',
                    metadata: { preferredSize: { width: 640, height: 480 } },
                },
            ]);
            expect(queue.getAll()[0]?.metadata).toEqual({
                source: 'preview',
                nested: { editable: true },
            });
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

        it('should not allow mutation through get()', async () => {
            const imageBytes = new Uint8Array([1, 2, 3]);
            const result = await queue.enqueue({
                content: [{ type: 'image', image: imageBytes, mimeType: 'image/png' }],
            });

            const msg = queue.get(result.id);
            msg?.content.push({ type: 'text', text: 'extra' });
            const imagePart = msg?.content[0];
            if (imagePart?.type !== 'image') throw new Error('Expected image part');
            if (!(imagePart.image instanceof Uint8Array)) throw new Error('Expected image bytes');
            imagePart.image[0] = 9;

            expect(queue.get(result.id)?.content).toEqual([
                { type: 'image', image: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
            ]);
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
                queue: 'steer',
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
