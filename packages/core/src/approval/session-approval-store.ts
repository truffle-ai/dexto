import { z } from 'zod';
import type { StorageManager } from '../storage/index.js';
import type { Logger } from '../logger/v2/types.js';

const ApprovedDirectoryTypeSchema = z.enum(['session', 'once']);

const PersistedApprovedDirectorySchema = z
    .object({
        path: z.string(),
        type: ApprovedDirectoryTypeSchema,
    })
    .strict();

const SessionApprovalStateSchema = z
    .object({
        toolPatterns: z.record(z.array(z.string())).default({}),
        approvedDirectories: z.array(PersistedApprovedDirectorySchema).default([]),
    })
    .strict();

export type PersistedApprovedDirectory = z.output<typeof PersistedApprovedDirectorySchema>;
export type SessionApprovalState = z.output<typeof SessionApprovalStateSchema>;

const DEFAULT_APPROVAL_STATE: SessionApprovalState = {
    toolPatterns: {},
    approvedDirectories: [],
};

export class SessionApprovalStore {
    private readonly cacheTtlSeconds: number;

    constructor(
        private readonly storageManager: StorageManager,
        private readonly logger: Logger,
        options: { cacheTtlMs?: number } = {}
    ) {
        const cacheTtlMs = options.cacheTtlMs ?? 3600000;
        this.cacheTtlSeconds = Math.max(1, Math.floor(cacheTtlMs / 1000));
    }

    private buildKey(sessionId?: string): string {
        return sessionId ? `session-approvals:${sessionId}` : 'session-approvals:global';
    }

    async load(sessionId?: string): Promise<SessionApprovalState> {
        const key = this.buildKey(sessionId);
        const cached = await this.storageManager.getCache().get<unknown>(key);
        if (cached !== undefined) {
            return this.parseState(cached, key);
        }

        const stored = await this.storageManager.getDatabase().get<unknown>(key);
        if (stored === undefined) {
            return structuredClone(DEFAULT_APPROVAL_STATE);
        }

        const parsed = this.parseState(stored, key);
        await this.storageManager.getCache().set(key, parsed, this.cacheTtlSeconds);
        return parsed;
    }

    async save(sessionId: string | undefined, state: SessionApprovalState): Promise<void> {
        const key = this.buildKey(sessionId);
        const normalized = SessionApprovalStateSchema.parse(state);
        await this.storageManager.getDatabase().set(key, normalized);
        await this.storageManager.getCache().set(key, normalized, this.cacheTtlSeconds);
    }

    async delete(sessionId?: string): Promise<void> {
        const key = this.buildKey(sessionId);
        await Promise.all([
            this.storageManager.getDatabase().delete(key),
            this.storageManager.getCache().delete(key),
        ]);
    }

    private parseState(value: unknown, key: string): SessionApprovalState {
        const result = SessionApprovalStateSchema.safeParse(value);
        if (result.success) {
            return result.data;
        }

        this.logger.warn('Invalid persisted approval state encountered; using defaults', {
            key,
            error: result.error.message,
        });
        return structuredClone(DEFAULT_APPROVAL_STATE);
    }
}
