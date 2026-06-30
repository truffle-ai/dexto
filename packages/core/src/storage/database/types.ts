/**
 * Persistent, reliable storage for important data with list operations for message history.
 * Data survives restarts and supports enumeration for settings management.
 */
export interface Database {
    // Basic operations
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T): Promise<void>;
    setIfAbsent<T>(key: string, value: T): Promise<{ value: T; inserted: boolean }>;
    delete(key: string): Promise<void>;

    // Enumeration for settings/user data
    list(prefix: string): Promise<string[]>;

    // List operations for message history
    append<T>(key: string, item: T): Promise<void>;
    /** Atomically replace a list with the updater result for one key. */
    updateList<T, R>(key: string, updater: (items: T[]) => { items: T[]; result: R }): Promise<R>;
    /** Get a range of items in chronological order (oldest first, matching insertion order) */
    getRange<T>(key: string, start: number, count: number): Promise<T[]>;

    // Connection management
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    getStoreType(): string;
}
