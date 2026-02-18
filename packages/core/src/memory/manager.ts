import type { Database } from '../storage/database/types.js';
import type { Memory, CreateMemoryInput, UpdateMemoryInput, ListMemoriesOptions } from './types.js';
import {
    MemorySchema,
    CreateMemoryInputSchema,
    UpdateMemoryInputSchema,
    ListMemoriesOptionsSchema,
} from './schemas.js';
import { MemoryError } from './errors.js';
import { MemoryErrorCode } from './error-codes.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import type { Logger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import { nanoid } from 'nanoid';

const MEMORY_KEY_PREFIX = 'memory:item:';

/**
 * MemoryManager handles CRUD operations for user memories
 *
 * Responsibilities:
 * - Store and retrieve memories from the database
 * - Validate memory data
 * - Generate unique IDs for memories
 * - Filter and search memories
 *
 * Storage format:
 * - Key: `memory:item:{id}`
 * - Value: Memory object
 *
 * TODO: Expand to support multi-scope memories (user, agent, entity, session)
 * with namespaced keys (e.g., `memory:user:{userId}:item:{id}`) and
 * context-aware retrieval.
 */
export class MemoryManager {
    private logger: Logger;

    constructor(
        private database: Database,
        logger: Logger
    ) {
        this.logger = logger.createChild(DextoLogComponent.MEMORY);
        this.logger.debug('MemoryManager initialized');
    }

    /**
     * Create a new memory
     */
    async create(input: CreateMemoryInput): Promise<Memory> {
        // Validate input
        const validatedInput = CreateMemoryInputSchema.parse(input);

        // Generate unique ID
        const id = nanoid(12);

        const now = Date.now();
        const memory: Memory = {
            id,
            content: validatedInput.content,
            createdAt: now,
            updatedAt: now,
            tags: validatedInput.tags,
            metadata: validatedInput.metadata,
        };

        // Validate the complete memory object
        const validatedMemory = MemorySchema.parse(memory);

        try {
            // Store in database
            await this.database.set(this.toKey(id), validatedMemory);
            this.logger.info(`Created memory: ${id}`);
            return validatedMemory;
        } catch (error) {
            throw MemoryError.storageError(
                `Failed to store memory: ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Get a memory by ID
     */
    async get(id: string): Promise<Memory> {
        if (!id || typeof id !== 'string') {
            throw MemoryError.invalidId(id);
        }

        try {
            const memory = await this.database.get<Memory>(this.toKey(id));
            if (!memory) {
                throw MemoryError.notFound(id);
            }
            return memory;
        } catch (error) {
            if (
                error instanceof DextoRuntimeError &&
                error.code === MemoryErrorCode.MEMORY_NOT_FOUND
            ) {
                throw error;
            }
            throw MemoryError.retrievalError(
                `Failed to retrieve memory: ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Update an existing memory
     */
    async update(id: string, input: UpdateMemoryInput): Promise<Memory> {
        if (!id || typeof id !== 'string') {
            throw MemoryError.invalidId(id);
        }

        // Validate input
        const validatedInput = UpdateMemoryInputSchema.parse(input);

        // Get existing memory
        const existing = await this.get(id);

        // Merge updates
        const updated: Memory = {
            ...existing,
            content:
                validatedInput.content !== undefined ? validatedInput.content : existing.content,
            tags: validatedInput.tags !== undefined ? validatedInput.tags : existing.tags,
            updatedAt: Date.now(),
        };

        // Merge metadata if provided
        if (validatedInput.metadata) {
            updated.metadata = {
                ...(existing.metadata || {}),
                ...validatedInput.metadata,
            };
        }

        // Validate the updated memory
        const validatedMemory = MemorySchema.parse(updated);

        try {
            await this.database.set(this.toKey(id), validatedMemory);
            this.logger.info(`Updated memory: ${id}`);
            return validatedMemory;
        } catch (error) {
            throw MemoryError.storageError(
                `Failed to update memory: ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Delete a memory by ID
     */
    async delete(id: string): Promise<void> {
        if (!id || typeof id !== 'string') {
            throw MemoryError.invalidId(id);
        }

        // Verify memory exists before deleting
        await this.get(id);

        try {
            await this.database.delete(this.toKey(id));
            this.logger.info(`Deleted memory: ${id}`);
        } catch (error) {
            throw MemoryError.deleteError(
                `Failed to delete memory: ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * List all memories with optional filtering
     */
    async list(options: ListMemoriesOptions = {}): Promise<Memory[]> {
        // Validate and parse options
        const validatedOptions = ListMemoriesOptionsSchema.parse(options);

        try {
            // Get all memory keys
            const keys = await this.database.list(MEMORY_KEY_PREFIX);

            // Retrieve all memories
            const memories: Memory[] = [];
            for (const key of keys) {
                try {
                    const memory = await this.database.get<Memory>(key);
                    if (memory) {
                        memories.push(memory);
                    }
                } catch (error) {
                    this.logger.warn(
                        `Failed to retrieve memory from key ${key}: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }

            // Apply filters
            let filtered = memories;

            // Filter by tags
            if (validatedOptions.tags && validatedOptions.tags.length > 0) {
                filtered = filtered.filter((m) =>
                    m.tags?.some((tag) => validatedOptions.tags!.includes(tag))
                );
            }

            // Filter by source
            if (validatedOptions.source) {
                filtered = filtered.filter((m) => m.metadata?.source === validatedOptions.source);
            }

            // Filter by pinned status
            if (validatedOptions.pinned !== undefined) {
                filtered = filtered.filter((m) => m.metadata?.pinned === validatedOptions.pinned);
            }

            // Sort by updatedAt descending (most recent first)
            filtered.sort((a, b) => b.updatedAt - a.updatedAt);

            // Apply pagination
            if (validatedOptions.offset !== undefined || validatedOptions.limit !== undefined) {
                const start = validatedOptions.offset ?? 0;
                const end = validatedOptions.limit ? start + validatedOptions.limit : undefined;
                filtered = filtered.slice(start, end);
            }

            return filtered;
        } catch (error) {
            throw MemoryError.retrievalError(
                `Failed to list memories: ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Check if a memory exists
     */
    async has(id: string): Promise<boolean> {
        try {
            await this.get(id);
            return true;
        } catch (error) {
            if (
                error instanceof DextoRuntimeError &&
                error.code === MemoryErrorCode.MEMORY_NOT_FOUND
            ) {
                return false;
            }
            throw error;
        }
    }

    /**
     * Get count of total memories
     */
    async count(options: ListMemoriesOptions = {}): Promise<number> {
        const memories = await this.list(options);
        return memories.length;
    }

    /**
     * Convert memory ID to database key
     */
    private toKey(id: string): string {
        return `${MEMORY_KEY_PREFIX}${id}`;
    }
}
