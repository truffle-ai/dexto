export interface CacheStore {
    get(input: { key: string }): Promise<unknown | undefined>;
    set(input: { key: string; value: unknown; ttlSeconds?: number }): Promise<void>;
    delete(input: { key: string }): Promise<void>;
}
