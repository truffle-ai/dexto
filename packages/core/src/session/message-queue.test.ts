import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageQueueService } from './message-queue.js';
import type { SessionEventBus } from '../events/index.js';
import type { ContentPart } from '../context/types.js';
import { createMockLogger } from '../logger/v2/test-utils.js';
import type { IDextoLogger } from '../logger/v2/types.js';

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
    let logger: IDextoLogger;
    let queue: MessageQueueService;

    beforeEach(() => {
        eventBus = createMockEventBus();
        logger = createMockLogger();
        queue = new MessageQueueService(eventBus, logger);
    });

    describe('enqueue()', () => {
        it('should add a message to the queue and return position and id', () => {
            const content: ContentPart[] = [{ type: 'text', text: 'hello' }];

            const result = queue.enqueue({ content });

            expect(result.queued).toBe(true);
            expect(result.position).toBe(1);
            expect(result.id).toMatch(/^msg_\d+_[a-z0-9]+$/);
        });

        it('should increment position for multiple enqueued messages', () => {
            const content: ContentPart[] = [{ type: 'text', text: 'hello' }];

            const result1 = queue.enqueue({ content });
            const result2 = queue.enqueue({ content });
            const result3 = queue.enqueue({ content });

            expect(result1.position).toBe(1);
            expect(result2.position).toBe(2);
            expect(result3.position).toBe(3);
        });

        it('should emit message:queued event with correct data', () => {
            const content: ContentPart[] = [{ type: 'text', text: 'hello' }];

            const result = queue.enqueue({ content });

            expect(eventBus.emit).toHaveBeenCalledWith('message:queued', {
                position: 1,
                id: result.id,
            });
        });

        it('should include metadata when provided', () => {
            const content: ContentPart[] = [{ type: 'text', text: 'hello' }];
            const metadata = { source: 'api', priority: 'high' };

            queue.enqueue({ content, metadata });
            const coalesced = queue.dequeueAll();

            expect(coalesced).not.toBeNull();
            const firstMessage = coalesced?.messages[0];
            expect(firstMessage?.metadata).toEqual(metadata);
        });

        it('should not include metadata field when not provided', () => {
            const content: ContentPart[] = [{ type: 'text', text: 'hello' }];

            queue.enqueue({ content });
            const coalesced = queue.dequeueAll();

            expect(coalesced).not.toBeNull();
            const firstMessage = coalesced?.messages[0];
            expect(firstMessage?.metadata).toBeUndefined();
        });
    });

    describe('dequeueAll()', () => {
        it('should return null when queue is empty', () => {
            const result = queue.dequeueAll();
            expect(result).toBeNull();
        });

        it('should return CoalescedMessage with single message', () => {
            const content: ContentPart[] = [{ type: 'text', text: 'hello' }];
            queue.enqueue({ content });

            const result = queue.dequeueAll();

            expect(result).not.toBeNull();
            expect(result?.messages).toHaveLength(1);
            expect(result?.combinedContent).toEqual(content);
        });

        it('should clear the queue after dequeue', () => {
            queue.enqueue({ content: [{ type: 'text', text: 'hello' }] });
            queue.dequeueAll();

            expect(queue.hasPending()).toBe(false);
            expect(queue.pendingCount()).toBe(0);
        });

        it('should emit message:dequeued event with correct data', () => {
            queue.enqueue({ content: [{ type: 'text', text: 'msg1' }] });
            queue.enqueue({ content: [{ type: 'text', text: 'msg2' }] });

            queue.dequeueAll();

            expect(eventBus.emit).toHaveBeenCalledWith('message:dequeued', {
                count: 2,
                ids: expect.arrayContaining([expect.stringMatching(/^msg_/)]),
                coalesced: true,
                content: expect.any(Array),
                messages: expect.any(Array),
            });
        });

        it('should set coalesced to false for single message', () => {
            queue.enqueue({ content: [{ type: 'text', text: 'solo' }] });

            queue.dequeueAll();

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
        it('should return single message content as-is', () => {
            const content: ContentPart[] = [
                { type: 'text', text: 'hello world' },
                { type: 'image', image: 'base64data', mimeType: 'image/png' },
            ];
            queue.enqueue({ content });

            const result = queue.dequeueAll();

            expect(result?.combinedContent).toEqual(content);
        });

        it('should prefix two messages with First and Also', () => {
            queue.enqueue({ content: [{ type: 'text', text: 'stop' }] });
            queue.enqueue({ content: [{ type: 'text', text: 'try another way' }] });

            const result = queue.dequeueAll();

            expect(result?.combinedContent).toHaveLength(3); // First + separator + Also
            expect(result?.combinedContent[0]).toEqual({ type: 'text', text: 'First: stop' });
            expect(result?.combinedContent[1]).toEqual({ type: 'text', text: '\n\n' });
            expect(result?.combinedContent[2]).toEqual({
                type: 'text',
                text: 'Also: try another way',
            });
        });

        it('should number three or more messages', () => {
            queue.enqueue({ content: [{ type: 'text', text: 'one' }] });
            queue.enqueue({ content: [{ type: 'text', text: 'two' }] });
            queue.enqueue({ content: [{ type: 'text', text: 'three' }] });

            const result = queue.dequeueAll();

            expect(result?.combinedContent).toHaveLength(5); // 3 messages + 2 separators
            expect(result?.combinedContent[0]).toEqual({ type: 'text', text: '[1]: one' });
            expect(result?.combinedContent[2]).toEqual({ type: 'text', text: '[2]: two' });
            expect(result?.combinedContent[4]).toEqual({ type: 'text', text: '[3]: three' });
        });

        it('should preserve multimodal content (text + images)', () => {
            queue.enqueue({
                content: [
                    { type: 'text', text: 'look at this' },
                    { type: 'image', image: 'base64img1', mimeType: 'image/png' },
                ],
            });
            queue.enqueue({
                content: [{ type: 'image', image: 'base64img2', mimeType: 'image/jpeg' }],
            });

            const result = queue.dequeueAll();

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

        it('should tag user messages in mixed batches', () => {
            queue.enqueue({ content: [{ type: 'text', text: 'user note' }] });
            queue.enqueue({
                content: [{ type: 'text', text: 'bg payload' }],
                kind: 'background',
            });

            const result = queue.dequeueAll();

            expect(result?.combinedContent[0]).toEqual({
                type: 'text',
                text: 'User follow-up 1: user note',
            });
            expect(result?.combinedContent[2]).toEqual({ type: 'text', text: 'bg payload' });
        });

        it('should handle empty message content with placeholder', () => {
            queue.enqueue({ content: [{ type: 'text', text: 'first' }] });
            queue.enqueue({ content: [] });

            const result = queue.dequeueAll();

            expect(result?.combinedContent).toContainEqual({
                type: 'text',
                text: 'Also: [empty message]',
            });
        });

        it('should set correct firstQueuedAt and lastQueuedAt timestamps', async () => {
            queue.enqueue({ content: [{ type: 'text', text: 'first' }] });

            // Small delay to ensure different timestamps
            await new Promise((resolve) => setTimeout(resolve, 10));

            queue.enqueue({ content: [{ type: 'text', text: 'second' }] });

            const result = queue.dequeueAll();

            expect(result?.firstQueuedAt).toBeLessThan(result?.lastQueuedAt ?? 0);
        });
    });

    describe('hasPending() and pendingCount()', () => {
        it('should return false and 0 for empty queue', () => {
            expect(queue.hasPending()).toBe(false);
            expect(queue.pendingCount()).toBe(0);
        });

        it('should return true and correct count for non-empty queue', () => {
            queue.enqueue({ content: [{ type: 'text', text: 'msg1' }] });
            queue.enqueue({ content: [{ type: 'text', text: 'msg2' }] });

            expect(queue.hasPending()).toBe(true);
            expect(queue.pendingCount()).toBe(2);
        });

        it('should update after dequeue', () => {
            queue.enqueue({ content: [{ type: 'text', text: 'msg1' }] });
            expect(queue.pendingCount()).toBe(1);

            queue.dequeueAll();

            expect(queue.hasPending()).toBe(false);
            expect(queue.pendingCount()).toBe(0);
        });
    });

    describe('clear()', () => {
        it('should empty the queue', () => {
            queue.enqueue({ content: [{ type: 'text', text: 'msg1' }] });
            queue.enqueue({ content: [{ type: 'text', text: 'msg2' }] });

            queue.clear();

            expect(queue.hasPending()).toBe(false);
            expect(queue.pendingCount()).toBe(0);
            expect(queue.dequeueAll()).toBeNull();
        });
    });

    describe('getAll()', () => {
        it('should return empty array when queue is empty', () => {
            expect(queue.getAll()).toEqual([]);
        });

        it('should return shallow copy of queued messages', () => {
            const result1 = queue.enqueue({ content: [{ type: 'text', text: 'msg1' }] });
            const result2 = queue.enqueue({ content: [{ type: 'text', text: 'msg2' }] });

            const all = queue.getAll();

            expect(all).toHaveLength(2);
            expect(all[0]?.id).toBe(result1.id);
            expect(all[1]?.id).toBe(result2.id);
        });

        it('should not allow external mutation of queue', () => {
            queue.enqueue({ content: [{ type: 'text', text: 'msg1' }] });

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

        it('should return message by id', () => {
            const content: ContentPart[] = [{ type: 'text', text: 'hello' }];
            const result = queue.enqueue({ content });

            const msg = queue.get(result.id);

            expect(msg).toBeDefined();
            expect(msg?.id).toBe(result.id);
            expect(msg?.content).toEqual(content);
        });
    });

    describe('remove()', () => {
        it('should return false for non-existent id', () => {
            const result = queue.remove('non-existent');

            expect(result).toBe(false);
            expect(logger.debug).toHaveBeenCalledWith(
                'Remove failed: message non-existent not found in queue'
            );
        });

        it('should remove message and return true', () => {
            const result = queue.enqueue({ content: [{ type: 'text', text: 'to remove' }] });

            const removed = queue.remove(result.id);

            expect(removed).toBe(true);
            expect(queue.get(result.id)).toBeUndefined();
            expect(queue.pendingCount()).toBe(0);
        });

        it('should emit message:removed event', () => {
            const result = queue.enqueue({ content: [{ type: 'text', text: 'to remove' }] });

            queue.remove(result.id);

            expect(eventBus.emit).toHaveBeenCalledWith('message:removed', {
                id: result.id,
            });
        });

        it('should log debug message on successful removal', () => {
            const result = queue.enqueue({ content: [{ type: 'text', text: 'to remove' }] });

            queue.remove(result.id);

            expect(logger.debug).toHaveBeenCalledWith(
                `Message removed: ${result.id}, remaining: 0`
            );
        });

        it('should maintain order of remaining messages', () => {
            const r1 = queue.enqueue({ content: [{ type: 'text', text: 'first' }] });
            const r2 = queue.enqueue({ content: [{ type: 'text', text: 'second' }] });
            const r3 = queue.enqueue({ content: [{ type: 'text', text: 'third' }] });

            queue.remove(r2.id);

            const all = queue.getAll();
            expect(all).toHaveLength(2);
            expect(all[0]?.id).toBe(r1.id);
            expect(all[1]?.id).toBe(r3.id);
        });
    });
});
