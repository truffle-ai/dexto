/**
 * Core memory types and interfaces
 */

/**
 * Supported memory sources
 */
export type MemorySource = 'user' | 'system';

/**
 * Memory item stored in the system
 */
export interface Memory {
    /** Unique identifier for the memory */
    id: string;
    /** The actual memory content */
    content: string;
    /** When the memory was created (Unix timestamp in milliseconds) */
    createdAt: number;
    /** When the memory was last updated (Unix timestamp in milliseconds) */
    updatedAt: number;
    /** Optional tags for categorization */
    tags?: string[] | undefined;
    /** Additional metadata */
    metadata?:
        | {
              /** Source of the memory */
              source?: MemorySource | undefined;
              /** Whether this memory is pinned (for future hybrid approach) */
              pinned?: boolean | undefined;
              /** Any additional custom metadata */
              [key: string]: unknown;
          }
        | undefined;
}

/**
 * Input for creating a new memory
 */
export interface CreateMemoryInput {
    /** The memory content */
    content: string;
    /** Optional tags */
    tags?: string[];
    /** Optional metadata */
    metadata?: {
        source?: MemorySource;
        [key: string]: unknown;
    };
}

/**
 * Input for updating an existing memory
 */
export interface UpdateMemoryInput {
    /** Updated content (optional) */
    content?: string;
    /** Updated tags (optional, replaces existing) */
    tags?: string[];
    /** Updated metadata (optional, merges with existing) */
    metadata?: {
        source?: MemorySource;
        pinned?: boolean;
        [key: string]: unknown;
    };
}

/**
 * Options for listing memories
 */
export interface ListMemoriesOptions {
    /** Filter by tags */
    tags?: string[];
    /** Filter by source */
    source?: MemorySource;
    /** Filter by pinned status */
    pinned?: boolean;
    /** Limit number of results */
    limit?: number;
    /** Skip first N results */
    offset?: number;
}
