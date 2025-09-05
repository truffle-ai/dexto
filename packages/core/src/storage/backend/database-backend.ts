/**
 * Persistent, reliable storage for important data with list operations for message history.
 * Data survives restarts and supports enumeration for settings management.
 */
export interface DatabaseBackend {
    // Basic operations
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;

    // Enumeration for settings/user data
    list(prefix: string): Promise<string[]>;

    // List operations for message history
    append<T>(key: string, item: T): Promise<void>;
    /** Get a range of items in chronological order (oldest first, matching insertion order) */
    getRange<T>(key: string, start: number, count: number): Promise<T[]>;

    // Connection management
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    getBackendType(): string;
}
