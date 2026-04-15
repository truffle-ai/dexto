import { z } from 'zod';
import type { StorageManager } from '../storage/index.js';
import type { Logger } from '../logger/v2/types.js';

const SessionToolPreferencesSchema = z
    .object({
        userAutoApproveTools: z.array(z.string()).default([]),
        disabledTools: z.array(z.string()).default([]),
    })
    .strict();

export type SessionToolPreferences = z.output<typeof SessionToolPreferencesSchema>;

const DEFAULT_SESSION_TOOL_PREFERENCES: SessionToolPreferences = {
    userAutoApproveTools: [],
    disabledTools: [],
};

export class SessionToolPreferencesStore {
    private readonly cacheTtlSeconds: number;

    constructor(
        private readonly storageManager: StorageManager,
        private readonly logger: Logger,
        options: { cacheTtlMs?: number } = {}
    ) {
        const cacheTtlMs = options.cacheTtlMs ?? 3600000;
        this.cacheTtlSeconds = Math.max(1, Math.floor(cacheTtlMs / 1000));
    }

    private buildKey(sessionId: string): string {
        return `session-tool-preferences:${sessionId}`;
    }

    async load(sessionId: string): Promise<SessionToolPreferences> {
        const key = this.buildKey(sessionId);
        const cached = await this.storageManager.getCache().get<unknown>(key);
        if (cached !== undefined) {
            return this.parsePreferences(cached, key);
        }

        const stored = await this.storageManager.getDatabase().get<unknown>(key);
        if (stored === undefined) {
            return structuredClone(DEFAULT_SESSION_TOOL_PREFERENCES);
        }

        const parsed = this.parsePreferences(stored, key);
        await this.storageManager.getCache().set(key, parsed, this.cacheTtlSeconds);
        return parsed;
    }

    async save(sessionId: string, preferences: SessionToolPreferences): Promise<void> {
        const key = this.buildKey(sessionId);
        const normalized = SessionToolPreferencesSchema.parse(preferences);
        await this.storageManager.getDatabase().set(key, normalized);
        await this.storageManager.getCache().set(key, normalized, this.cacheTtlSeconds);
    }

    async delete(sessionId: string): Promise<void> {
        const key = this.buildKey(sessionId);
        await Promise.all([
            this.storageManager.getDatabase().delete(key),
            this.storageManager.getCache().delete(key),
        ]);
    }

    private parsePreferences(value: unknown, key: string): SessionToolPreferences {
        const result = SessionToolPreferencesSchema.safeParse(value);
        if (result.success) {
            return result.data;
        }

        this.logger.warn('Invalid persisted session tool preferences encountered; using defaults', {
            key,
            error: result.error.message,
        });
        return structuredClone(DEFAULT_SESSION_TOOL_PREFERENCES);
    }
}
