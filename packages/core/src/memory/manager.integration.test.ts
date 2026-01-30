import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from './manager.js';
// Import from index to ensure providers are registered
import { createDatabase } from '../storage/database/index.js';
import type { Database } from '../storage/database/types.js';
import type { CreateMemoryInput } from './types.js';
import { createMockLogger } from '../logger/v2/test-utils.js';

describe('MemoryManager Integration Tests', () => {
    let memoryManager: MemoryManager;
    let database: Database;
    const mockLogger = createMockLogger();

    beforeEach(async () => {
        // Use in-memory database for integration tests
        database = await createDatabase({ type: 'in-memory' }, mockLogger);
        await database.connect();
        memoryManager = new MemoryManager(database, mockLogger);
    });

    afterEach(async () => {
        await database.disconnect();
    });

    it('should create, retrieve, update, and delete a memory', async () => {
        // Create
        const input: CreateMemoryInput = {
            content: 'Integration test memory',
            tags: ['test', 'integration'],
            metadata: { source: 'user' },
        };

        const created = await memoryManager.create(input);
        expect(created.id).toBeDefined();
        expect(created.content).toBe('Integration test memory');

        // Retrieve
        const retrieved = await memoryManager.get(created.id);
        expect(retrieved).toEqual(created);

        // Update
        const updated = await memoryManager.update(created.id, {
            content: 'Updated content',
            tags: ['updated'],
        });
        expect(updated.content).toBe('Updated content');
        expect(updated.tags).toEqual(['updated']);
        expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

        // Delete
        await memoryManager.delete(created.id);
        await expect(memoryManager.get(created.id)).rejects.toThrow('Memory not found');
    });

    it('should list and filter memories correctly', async () => {
        // Create multiple memories
        const memories = await Promise.all([
            memoryManager.create({
                content: 'Work memory',
                tags: ['work', 'important'],
            }),
            memoryManager.create({
                content: 'Personal memory',
                tags: ['personal'],
            }),
            memoryManager.create({
                content: 'Another work memory',
                tags: ['work'],
            }),
        ]);

        // List all
        const allMemories = await memoryManager.list();
        expect(allMemories).toHaveLength(3);

        // Filter by tag
        const workMemories = await memoryManager.list({ tags: ['work'] });
        expect(workMemories).toHaveLength(2);

        // Count
        const count = await memoryManager.count({ tags: ['work'] });
        expect(count).toBe(2);

        // Limit
        const limited = await memoryManager.list({ limit: 2 });
        expect(limited).toHaveLength(2);

        // Cleanup
        for (const memory of memories) {
            await memoryManager.delete(memory.id);
        }
    });

    it('should handle metadata correctly across operations', async () => {
        const input: CreateMemoryInput = {
            content: 'Memory with metadata',
            metadata: {
                source: 'user',
                customField: 'custom value',
            },
        };

        const created = await memoryManager.create(input);
        expect(created.metadata).toMatchObject({
            source: 'user',
            customField: 'custom value',
        });

        // Update with additional metadata
        const updated = await memoryManager.update(created.id, {
            metadata: {
                pinned: true,
                anotherField: 'another value',
            },
        });

        // Should merge with existing metadata
        expect(updated.metadata).toMatchObject({
            source: 'user',
            customField: 'custom value',
            pinned: true,
            anotherField: 'another value',
        });

        await memoryManager.delete(created.id);
    });

    it('should maintain sort order (most recently updated first)', async () => {
        const mem1 = await memoryManager.create({ content: 'First' });
        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 10));
        const mem2 = await memoryManager.create({ content: 'Second' });
        await new Promise((resolve) => setTimeout(resolve, 10));
        const mem3 = await memoryManager.create({ content: 'Third' });

        const list = await memoryManager.list();

        // Should be in reverse chronological order (newest first)
        expect(list[0]!.id).toBe(mem3.id);
        expect(list[1]!.id).toBe(mem2.id);
        expect(list[2]!.id).toBe(mem1.id);

        // Update the first one
        await new Promise((resolve) => setTimeout(resolve, 10));
        await memoryManager.update(mem1.id, { content: 'First Updated' });

        const updatedList = await memoryManager.list();

        // Now mem1 should be first (most recently updated)
        expect(updatedList[0]!.id).toBe(mem1.id);

        // Cleanup
        await memoryManager.delete(mem1.id);
        await memoryManager.delete(mem2.id);
        await memoryManager.delete(mem3.id);
    });

    it('should handle edge cases gracefully', async () => {
        // Create memory with minimal data
        const minimal = await memoryManager.create({ content: 'Minimal' });
        expect(minimal.tags).toBeUndefined();
        expect(minimal.metadata).toBeUndefined();

        // Update with empty updates (should not throw)
        const updated = await memoryManager.update(minimal.id, {});
        expect(updated.content).toBe('Minimal');

        // Has method
        expect(await memoryManager.has(minimal.id)).toBe(true);
        expect(await memoryManager.has('non-existent-id')).toBe(false);

        // List with no results
        await memoryManager.delete(minimal.id);
        const empty = await memoryManager.list();
        expect(empty).toHaveLength(0);
    });

    it('should validate memory content length', async () => {
        // Content too long (>10000 characters)
        const longContent = 'a'.repeat(10001);

        await expect(memoryManager.create({ content: longContent })).rejects.toThrow();
    });

    it('should validate tags', async () => {
        // Too many tags (>10)
        const manyTags = Array.from({ length: 11 }, (_, i) => `tag${i}`);

        await expect(
            memoryManager.create({
                content: 'Test',
                tags: manyTags,
            })
        ).rejects.toThrow();

        // Tag too long (>50 characters)
        const longTag = 'a'.repeat(51);

        await expect(
            memoryManager.create({
                content: 'Test',
                tags: [longTag],
            })
        ).rejects.toThrow();
    });
});
