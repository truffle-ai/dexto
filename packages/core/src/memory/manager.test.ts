import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryManager } from './manager.js';
import type { MemoryStore } from '../storage/memories/types.js';
import type { CreateMemoryInput, UpdateMemoryInput } from './types.js';
import { createMockLogger } from '../logger/v2/test-utils.js';

describe('MemoryManager', () => {
    let memoryManager: MemoryManager;
    let mockMemoryStore: MemoryStore;
    const mockLogger = createMockLogger();

    beforeEach(() => {
        mockMemoryStore = {
            create: vi.fn(),
            get: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            list: vi.fn(),
        };

        memoryManager = new MemoryManager(mockMemoryStore, mockLogger);
    });

    describe('create', () => {
        it('should create a memory with valid input', async () => {
            const input: CreateMemoryInput = {
                content: 'Test memory content',
                tags: ['work', 'important'],
                metadata: { source: 'user' },
            };

            vi.mocked(mockMemoryStore.create).mockResolvedValue(undefined);

            const memory = await memoryManager.create(input);

            expect(memory).toMatchObject({
                content: 'Test memory content',
                tags: ['work', 'important'],
            });
            expect(memory.id).toBeDefined();
            expect(memory.createdAt).toBeDefined();
            expect(memory.updatedAt).toBeDefined();
            expect(memory.metadata?.source).toBe('user');
            expect(mockMemoryStore.create).toHaveBeenCalledWith({
                memory: expect.objectContaining({ content: 'Test memory content' }),
            });
        });

        it('should create a memory without optional fields', async () => {
            const input: CreateMemoryInput = {
                content: 'Simple memory',
            };

            vi.mocked(mockMemoryStore.create).mockResolvedValue(undefined);

            const memory = await memoryManager.create(input);

            expect(memory.content).toBe('Simple memory');
            expect(memory.tags).toBeUndefined();
            expect(memory.metadata).toBeUndefined();
        });

        it('should throw validation error for empty content', async () => {
            const input = {
                content: '',
            } as CreateMemoryInput;

            await expect(memoryManager.create(input)).rejects.toThrow();
        });

        it('should throw storage error if database fails', async () => {
            const input: CreateMemoryInput = {
                content: 'Test memory',
            };

            vi.mocked(mockMemoryStore.create).mockRejectedValue(new Error('Database error'));

            await expect(memoryManager.create(input)).rejects.toThrow('Memory storage error');
        });
    });

    describe('get', () => {
        it('should retrieve an existing memory', async () => {
            const mockMemory = {
                id: 'test-id',
                content: 'Test memory',
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            vi.mocked(mockMemoryStore.get).mockResolvedValue(mockMemory);

            const memory = await memoryManager.get('test-id');

            expect(memory).toEqual(mockMemory);
            expect(mockMemoryStore.get).toHaveBeenCalledWith({ id: 'test-id' });
        });

        it('should throw not found error for non-existent memory', async () => {
            vi.mocked(mockMemoryStore.get).mockResolvedValue(undefined);

            await expect(memoryManager.get('non-existent')).rejects.toThrow('Memory not found');
        });

        it('should throw error for invalid ID', async () => {
            await expect(memoryManager.get('')).rejects.toThrow('Invalid memory ID');
        });
    });

    describe('update', () => {
        it('should update memory content', async () => {
            const existingMemory = {
                id: 'test-id',
                content: 'Original content',
                createdAt: Date.now() - 1000,
                updatedAt: Date.now() - 1000,
            };

            const updates: UpdateMemoryInput = {
                content: 'Updated content',
            };

            vi.mocked(mockMemoryStore.get).mockResolvedValue(existingMemory);
            vi.mocked(mockMemoryStore.update).mockResolvedValue(undefined);

            const updatedMemory = await memoryManager.update('test-id', updates);

            expect(updatedMemory.content).toBe('Updated content');
            expect(updatedMemory.updatedAt).toBeGreaterThan(existingMemory.updatedAt);
            expect(updatedMemory.createdAt).toBe(existingMemory.createdAt);
        });

        it('should update memory tags', async () => {
            const existingMemory = {
                id: 'test-id',
                content: 'Test content',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                tags: ['old-tag'],
            };

            const updates: UpdateMemoryInput = {
                tags: ['new-tag', 'another-tag'],
            };

            vi.mocked(mockMemoryStore.get).mockResolvedValue(existingMemory);
            vi.mocked(mockMemoryStore.update).mockResolvedValue(undefined);

            const updatedMemory = await memoryManager.update('test-id', updates);

            expect(updatedMemory.tags).toEqual(['new-tag', 'another-tag']);
        });

        it('should merge metadata on update', async () => {
            const existingMemory = {
                id: 'test-id',
                content: 'Test content',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                metadata: {
                    source: 'user' as const,
                    customField: 'value',
                },
            };

            const updates: UpdateMemoryInput = {
                metadata: {
                    pinned: true,
                },
            };

            vi.mocked(mockMemoryStore.get).mockResolvedValue(existingMemory);
            vi.mocked(mockMemoryStore.update).mockResolvedValue(undefined);

            const updatedMemory = await memoryManager.update('test-id', updates);

            expect(updatedMemory.metadata).toMatchObject({
                source: 'user',
                customField: 'value',
                pinned: true,
            });
        });
    });

    describe('delete', () => {
        it('should delete an existing memory', async () => {
            const existingMemory = {
                id: 'test-id',
                content: 'Test content',
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            vi.mocked(mockMemoryStore.get).mockResolvedValue(existingMemory);
            vi.mocked(mockMemoryStore.delete).mockResolvedValue(undefined);

            await memoryManager.delete('test-id');

            expect(mockMemoryStore.delete).toHaveBeenCalledWith({ id: 'test-id' });
        });

        it('should throw error if memory does not exist', async () => {
            vi.mocked(mockMemoryStore.get).mockResolvedValue(undefined);

            await expect(memoryManager.delete('non-existent')).rejects.toThrow('Memory not found');
        });
    });

    describe('list', () => {
        it('should list all memories', async () => {
            const mockMemories = [
                {
                    id: 'mem-1',
                    content: 'Memory 1',
                    createdAt: Date.now() - 2000,
                    updatedAt: Date.now() - 2000,
                },
                {
                    id: 'mem-2',
                    content: 'Memory 2',
                    createdAt: Date.now() - 1000,
                    updatedAt: Date.now() - 1000,
                },
            ];

            vi.mocked(mockMemoryStore.list).mockResolvedValue(mockMemories);

            const memories = await memoryManager.list();

            expect(memories).toHaveLength(2);
            // Should be sorted by updatedAt descending (most recent first)
            expect(memories[0]!.id).toBe('mem-2');
            expect(memories[1]!.id).toBe('mem-1');
        });

        it('should filter memories by tags', async () => {
            const mockMemories = [
                {
                    id: 'mem-1',
                    content: 'Memory 1',
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    tags: ['work', 'important'],
                },
                {
                    id: 'mem-2',
                    content: 'Memory 2',
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    tags: ['personal'],
                },
            ];

            vi.mocked(mockMemoryStore.list).mockResolvedValue(mockMemories);

            const memories = await memoryManager.list({ tags: ['work'] });

            expect(memories).toHaveLength(1);
            expect(memories[0]!.id).toBe('mem-1');
        });

        it('should apply limit and offset', async () => {
            const mockMemories = Array.from({ length: 5 }, (_, i) => ({
                id: `mem-${i}`,
                content: `Memory ${i}`,
                createdAt: Date.now() - (5 - i) * 1000,
                updatedAt: Date.now() - (5 - i) * 1000,
            }));

            vi.mocked(mockMemoryStore.list).mockResolvedValue(mockMemories);

            const memories = await memoryManager.list({ limit: 2, offset: 1 });

            expect(memories).toHaveLength(2);
            // After sorting by updatedAt desc and applying offset 1, limit 2
            expect(memories[0]!.id).toBe('mem-3');
            expect(memories[1]!.id).toBe('mem-2');
        });

        describe('query', () => {
            const now = Date.now();
            const searchMemories = [
                {
                    id: 'mem-deploy',
                    content: 'Deploy to staging every Friday before 5pm',
                    createdAt: now - 3000,
                    updatedAt: now - 3000,
                    tags: ['ops'],
                },
                {
                    id: 'mem-style',
                    content: 'User prefers concise answers',
                    createdAt: now - 2000,
                    updatedAt: now - 2000,
                    tags: ['preferences'],
                    metadata: { pinned: true },
                },
                {
                    id: 'mem-db',
                    content: 'Staging database is Postgres 16',
                    createdAt: now - 1000,
                    updatedAt: now - 1000,
                    tags: ['infra'],
                },
            ];

            beforeEach(() => {
                vi.mocked(mockMemoryStore.list).mockResolvedValue(searchMemories);
            });

            it('should match keywords in content case-insensitively', async () => {
                const memories = await memoryManager.list({ query: 'STAGING' });

                // Sorted by updatedAt descending
                expect(memories.map((m) => m.id)).toEqual(['mem-db', 'mem-deploy']);
            });

            it('should match keywords in tags', async () => {
                const memories = await memoryManager.list({ query: 'preferences' });

                expect(memories.map((m) => m.id)).toEqual(['mem-style']);
            });

            it('should require every term to match', async () => {
                const memories = await memoryManager.list({ query: '  staging   friday ' });

                expect(memories.map((m) => m.id)).toEqual(['mem-deploy']);
            });

            it('should match terms across content and tags', async () => {
                const memories = await memoryManager.list({ query: 'postgres infra' });

                expect(memories.map((m) => m.id)).toEqual(['mem-db']);
            });

            it('should return an empty list when nothing matches', async () => {
                const memories = await memoryManager.list({ query: 'kubernetes' });

                expect(memories).toEqual([]);
            });

            it('should combine with other filters and pagination', async () => {
                const byTag = await memoryManager.list({ query: 'staging', tags: ['ops'] });
                expect(byTag.map((m) => m.id)).toEqual(['mem-deploy']);

                const byPinned = await memoryManager.list({ query: 'staging', pinned: true });
                expect(byPinned).toEqual([]);

                const paged = await memoryManager.list({ query: 'staging', limit: 1, offset: 1 });
                expect(paged.map((m) => m.id)).toEqual(['mem-deploy']);
            });

            it('should reject an empty or whitespace-only query', async () => {
                await expect(memoryManager.list({ query: '' })).rejects.toThrow();
                await expect(memoryManager.list({ query: '   ' })).rejects.toThrow();
            });

            it('should count matches with the same filters', async () => {
                await expect(memoryManager.count({ query: 'staging' })).resolves.toBe(2);
            });
        });
    });

    describe('has', () => {
        it('should return true for existing memory', async () => {
            vi.mocked(mockMemoryStore.get).mockResolvedValue({
                id: 'test-id',
                content: 'Test',
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });

            const exists = await memoryManager.has('test-id');

            expect(exists).toBe(true);
        });

        it('should return false for non-existent memory', async () => {
            vi.mocked(mockMemoryStore.get).mockResolvedValue(undefined);

            const exists = await memoryManager.has('non-existent');

            expect(exists).toBe(false);
        });
    });

    describe('count', () => {
        it('should return total count of memories', async () => {
            const mockMemories = Array.from({ length: 3 }, (_, i) => ({
                id: `mem-${i}`,
                content: `Memory ${i}`,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            }));

            vi.mocked(mockMemoryStore.list).mockResolvedValue(mockMemories);

            const count = await memoryManager.count();

            expect(count).toBe(3);
        });
    });
});
