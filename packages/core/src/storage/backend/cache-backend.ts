/**
 * Fast, ephemeral storage for temporary data and performance optimization.
 * Supports TTL for automatic cleanup of temporary data.
 */
export interface CacheBackend {
    // Basic operations
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<void>;

    // Connection management
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    getBackendType(): string;
}
