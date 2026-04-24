import { z } from 'zod';
import type { ApprovalRequest, ApprovalResponse } from '../../approval/types.js';
import { ApprovalRequestSchema, ApprovalResponseSchema } from '../../approval/schemas.js';
import type { SessionApprovalState } from '../../approval/session-approval-store.js';
import type { QueuedMessage } from '../../session/types.js';
import type { SessionToolPreferences } from '../../tools/session-tool-preferences-store.js';
import type { ApprovalStore } from '../approvals/types.js';
import type {
    ArtifactData,
    ArtifactInput,
    ArtifactMetadata,
    ArtifactReference,
    ArtifactStats,
    ArtifactStore,
} from '../artifacts/types.js';
import type { BlobData, BlobReference, BlobStore, StoredBlobMetadata } from '../blob/types.js';
import type { Cache } from '../cache/types.js';
import type { CacheStore } from '../cache-store/types.js';
import type { Database } from '../database/types.js';
import { DatabaseConversationStore } from '../conversation/database.js';
import type { SessionMessageQueueStore } from '../message-queue/types.js';
import type { RuntimeEventRecord, RuntimeEventStore } from '../runtime-events/types.js';
import type { ToolPreferenceStore } from '../tool-preferences/types.js';
import type { DextoStoreMap, DextoStoreName, DextoStores } from './types.js';
import type { Logger } from '../../logger/v2/types.js';

const GLOBAL_SCOPE = 'global';
const RUNTIME_EVENTS_KEY = 'runtime-events';
const RUNTIME_EVENTS_LIMIT = 10000;

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

const SessionToolPreferencesSchema = z
    .object({
        userAutoApproveTools: z.array(z.string()).default([]),
        disabledTools: z.array(z.string()).default([]),
    })
    .strict();

const DEFAULT_APPROVAL_STATE: SessionApprovalState = {
    toolPatterns: {},
    approvedDirectories: [],
};

const DEFAULT_TOOL_PREFERENCES: SessionToolPreferences = {
    userAutoApproveTools: [],
    disabledTools: [],
};

class DatabaseBackedCacheStore implements CacheStore {
    constructor(private readonly cache: Cache) {}

    async get(input: { key: string }): Promise<unknown | undefined> {
        return await this.cache.get(input.key);
    }

    async set(input: { key: string; value: unknown; ttlSeconds?: number }): Promise<void> {
        await this.cache.set(input.key, input.value, input.ttlSeconds);
    }

    async delete(input: { key: string }): Promise<void> {
        await this.cache.delete(input.key);
    }
}

class DatabaseBackedArtifactStore implements ArtifactStore {
    constructor(private readonly blobStore: BlobStore) {}

    async store(input: {
        data: ArtifactInput;
        metadata?: ArtifactMetadata;
    }): Promise<ArtifactReference> {
        const reference = await this.blobStore.store(input.data, input.metadata);
        return this.toArtifactReference(reference);
    }

    async retrieve(input: {
        reference: string;
        format?: 'base64' | 'buffer' | 'path' | 'stream' | 'url';
    }): Promise<ArtifactData> {
        const data = await this.blobStore.retrieve(input.reference, input.format);
        return this.toArtifactData(data);
    }

    async exists(input: { reference: string }): Promise<boolean> {
        return await this.blobStore.exists(input.reference);
    }

    async delete(input: { reference: string }): Promise<void> {
        await this.blobStore.delete(input.reference);
    }

    async cleanup(input?: { olderThan?: Date }): Promise<number> {
        return await this.blobStore.cleanup(input?.olderThan);
    }

    async getStats(): Promise<ArtifactStats> {
        const stats = await this.blobStore.getStats();
        return {
            count: stats.count,
            totalSize: stats.totalSize,
            backendType: stats.backendType,
            storePath: stats.storePath,
        };
    }

    async listArtifacts(): Promise<ArtifactReference[]> {
        const references = await this.blobStore.listBlobs();
        return references.map((reference) => this.toArtifactReference(reference));
    }

    getStoragePath(): string | undefined {
        return this.blobStore.getStoragePath();
    }

    private toArtifactReference(reference: BlobReference): ArtifactReference {
        return {
            id: reference.id,
            uri: reference.uri,
            metadata: this.toArtifactMetadata(reference.metadata),
        };
    }

    private toArtifactData(data: BlobData): ArtifactData {
        switch (data.format) {
            case 'base64':
                return {
                    format: data.format,
                    data: data.data,
                    metadata: this.toArtifactMetadata(data.metadata),
                };
            case 'buffer':
                return {
                    format: data.format,
                    data: data.data,
                    metadata: this.toArtifactMetadata(data.metadata),
                };
            case 'path':
                return {
                    format: data.format,
                    data: data.data,
                    metadata: this.toArtifactMetadata(data.metadata),
                };
            case 'stream':
                return {
                    format: data.format,
                    data: data.data,
                    metadata: this.toArtifactMetadata(data.metadata),
                };
            case 'url':
                return {
                    format: data.format,
                    data: data.data,
                    metadata: this.toArtifactMetadata(data.metadata),
                };
        }
    }

    private toArtifactMetadata(metadata: StoredBlobMetadata): ArtifactReference['metadata'] {
        return {
            id: metadata.id,
            mimeType: metadata.mimeType,
            createdAt: metadata.createdAt,
            size: metadata.size,
            hash: metadata.hash,
            ...(metadata.originalName !== undefined ? { originalName: metadata.originalName } : {}),
            ...(metadata.source !== undefined ? { source: metadata.source } : {}),
        };
    }
}

class DatabaseBackedApprovalStore implements ApprovalStore {
    constructor(
        private readonly database: Database,
        private readonly cache: Cache,
        private readonly logger: Logger
    ) {}

    async createRequest(input: { request: ApprovalRequest }): Promise<void> {
        const request = ApprovalRequestSchema.parse(input.request);
        await this.database.set(this.requestKey(request.approvalId), request);
    }

    async getRequest(input: { approvalId: string }): Promise<ApprovalRequest | undefined> {
        const stored = await this.database.get<unknown>(this.requestKey(input.approvalId));
        return this.parseRequest(stored);
    }

    async listPending(input: { sessionId?: string }): Promise<ApprovalRequest[]> {
        const keys = await this.database.list('approval-request:');
        const pending: ApprovalRequest[] = [];
        for (const key of keys) {
            const stored = await this.database.get<unknown>(key);
            const request = this.parseRequest(stored);
            if (!request) {
                continue;
            }
            if (input.sessionId !== undefined && request.sessionId !== input.sessionId) {
                continue;
            }
            const response = await this.getResponse({ approvalId: request.approvalId });
            if (!response) {
                pending.push(request);
            }
        }
        return pending;
    }

    async saveResponse(input: { response: ApprovalResponse }): Promise<void> {
        const response = ApprovalResponseSchema.parse(input.response);
        await this.database.set(this.responseKey(response.approvalId), response);
    }

    async getResponse(input: { approvalId: string }): Promise<ApprovalResponse | undefined> {
        const stored = await this.database.get<unknown>(this.responseKey(input.approvalId));
        return this.parseResponse(stored);
    }

    async loadSessionState(input: { sessionId?: string }): Promise<SessionApprovalState> {
        const key = this.sessionStateKey(input.sessionId);
        const cached = await this.cache.get<unknown>(key);
        if (cached !== undefined) {
            return this.parseSessionState(cached, key);
        }

        const stored = await this.database.get<unknown>(key);
        if (stored === undefined) {
            return structuredClone(DEFAULT_APPROVAL_STATE);
        }

        const parsed = this.parseSessionState(stored, key);
        await this.cache.set(key, parsed, 3600);
        return parsed;
    }

    async saveSessionState(input: {
        sessionId?: string;
        state: SessionApprovalState;
    }): Promise<void> {
        const key = this.sessionStateKey(input.sessionId);
        const state = SessionApprovalStateSchema.parse(input.state);
        await this.database.set(key, state);
        await this.cache.set(key, state, 3600);
    }

    async deleteSessionState(input: { sessionId?: string }): Promise<void> {
        const key = this.sessionStateKey(input.sessionId);
        await Promise.all([this.database.delete(key), this.cache.delete(key)]);
    }

    private parseRequest(value: unknown): ApprovalRequest | undefined {
        const result = ApprovalRequestSchema.safeParse(value);
        return result.success ? result.data : undefined;
    }

    private parseResponse(value: unknown): ApprovalResponse | undefined {
        const result = ApprovalResponseSchema.safeParse(value);
        return result.success ? result.data : undefined;
    }

    private parseSessionState(value: unknown, key: string): SessionApprovalState {
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

    private requestKey(approvalId: string): string {
        return `approval-request:${approvalId}`;
    }

    private responseKey(approvalId: string): string {
        return `approval-response:${approvalId}`;
    }

    private sessionStateKey(sessionId: string | undefined): string {
        return sessionId ? `session-approvals:${sessionId}` : 'session-approvals:global';
    }
}

class DatabaseBackedToolPreferenceStore implements ToolPreferenceStore {
    constructor(
        private readonly database: Database,
        private readonly cache: Cache,
        private readonly logger: Logger
    ) {}

    async allowTool(input: { toolName: string; sessionId?: string }): Promise<void> {
        const tools = await this.listAllowedTools(this.scope(input.sessionId));
        if (tools.includes(input.toolName)) {
            return;
        }
        await this.database.set(this.allowedToolsKey(input.sessionId), [...tools, input.toolName]);
    }

    async disallowTool(input: { toolName: string; sessionId?: string }): Promise<void> {
        const tools = await this.listAllowedTools(this.scope(input.sessionId));
        await this.database.set(
            this.allowedToolsKey(input.sessionId),
            tools.filter((toolName) => toolName !== input.toolName)
        );
    }

    async isToolAllowed(input: { toolName: string; sessionId?: string }): Promise<boolean> {
        const sessionTools = await this.listAllowedTools(this.scope(input.sessionId));
        if (sessionTools.includes(input.toolName)) {
            return true;
        }
        const globalTools = await this.listAllowedTools({});
        return globalTools.includes(input.toolName);
    }

    async listAllowedTools(input: { sessionId?: string }): Promise<string[]> {
        const stored = await this.database.get<unknown>(this.allowedToolsKey(input.sessionId));
        return Array.isArray(stored) ? stored.filter((value) => typeof value === 'string') : [];
    }

    async loadSessionPreferences(input: { sessionId: string }): Promise<SessionToolPreferences> {
        const key = this.sessionPreferencesKey(input.sessionId);
        const cached = await this.cache.get<unknown>(key);
        if (cached !== undefined) {
            return this.parsePreferences(cached, key);
        }

        const stored = await this.database.get<unknown>(key);
        if (stored === undefined) {
            return structuredClone(DEFAULT_TOOL_PREFERENCES);
        }

        const parsed = this.parsePreferences(stored, key);
        await this.cache.set(key, parsed, 3600);
        return parsed;
    }

    async saveSessionPreferences(input: {
        sessionId: string;
        preferences: SessionToolPreferences;
    }): Promise<void> {
        const key = this.sessionPreferencesKey(input.sessionId);
        const preferences = SessionToolPreferencesSchema.parse(input.preferences);
        await this.database.set(key, preferences);
        await this.cache.set(key, preferences, 3600);
    }

    async deleteSessionPreferences(input: { sessionId: string }): Promise<void> {
        const key = this.sessionPreferencesKey(input.sessionId);
        await Promise.all([this.database.delete(key), this.cache.delete(key)]);
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
        return structuredClone(DEFAULT_TOOL_PREFERENCES);
    }

    private allowedToolsKey(sessionId: string | undefined): string {
        return sessionId ? `allowedTools:${sessionId}` : `allowedTools:${GLOBAL_SCOPE}`;
    }

    private scope(sessionId: string | undefined): { sessionId?: string } {
        return sessionId === undefined ? {} : { sessionId };
    }

    private sessionPreferencesKey(sessionId: string): string {
        return `session-tool-preferences:${sessionId}`;
    }
}

class DatabaseBackedSessionMessageQueueStore implements SessionMessageQueueStore {
    constructor(
        private readonly database: Database,
        private readonly cache: Cache,
        private readonly logger: Logger
    ) {}

    async load(input: { sessionId: string }): Promise<QueuedMessage[]> {
        const key = this.key(input.sessionId);
        const cached = await this.cache.get<unknown>(key);
        if (Array.isArray(cached)) {
            return structuredClone(cached);
        }

        const stored = await this.database.get<unknown>(key);
        if (!Array.isArray(stored)) {
            if (stored !== undefined) {
                this.logger.warn('Invalid persisted message queue encountered; ignoring state', {
                    key,
                });
            }
            return [];
        }

        const queue = structuredClone(stored);
        await this.cache.set(key, queue, 3600);
        return queue;
    }

    async save(input: { sessionId: string; queue: QueuedMessage[] }): Promise<void> {
        const key = this.key(input.sessionId);
        if (input.queue.length === 0) {
            await this.delete({ sessionId: input.sessionId });
            return;
        }

        const queue = structuredClone(input.queue);
        await this.database.set(key, queue);
        await this.cache.set(key, queue, 3600);
    }

    async delete(input: { sessionId: string }): Promise<void> {
        const key = this.key(input.sessionId);
        await Promise.all([this.database.delete(key), this.cache.delete(key)]);
    }

    private key(sessionId: string): string {
        return `session-message-queue:${sessionId}`;
    }
}

class DatabaseBackedRuntimeEventStore implements RuntimeEventStore {
    constructor(private readonly database: Database) {}

    async append(input: { event: RuntimeEventRecord }): Promise<void> {
        await this.database.append(RUNTIME_EVENTS_KEY, structuredClone(input.event));
    }

    async list(input: {
        sessionId?: string;
        runId?: string;
        limit?: number;
    }): Promise<RuntimeEventRecord[]> {
        const events = await this.database.getRange<RuntimeEventRecord>(
            RUNTIME_EVENTS_KEY,
            0,
            RUNTIME_EVENTS_LIMIT
        );
        const filtered = events.filter((event) => {
            if (input.sessionId !== undefined && event.sessionId !== input.sessionId) {
                return false;
            }
            if (input.runId !== undefined && event.runId !== input.runId) {
                return false;
            }
            return true;
        });
        return structuredClone(input.limit === undefined ? filtered : filtered.slice(-input.limit));
    }
}

export interface DatabaseBackedDextoStoresBackends {
    cache: Cache;
    database: Database;
    blobStore: BlobStore;
}

export class DatabaseBackedDextoStores implements DextoStores {
    private connected = false;
    private readonly stores: DextoStoreMap;

    constructor(
        private readonly backends: DatabaseBackedDextoStoresBackends,
        logger: Logger
    ) {
        this.stores = {
            conversation: new DatabaseConversationStore(backends.database, logger),
            approvals: new DatabaseBackedApprovalStore(backends.database, backends.cache, logger),
            toolPreferences: new DatabaseBackedToolPreferenceStore(
                backends.database,
                backends.cache,
                logger
            ),
            messageQueue: new DatabaseBackedSessionMessageQueueStore(
                backends.database,
                backends.cache,
                logger
            ),
            artifacts: new DatabaseBackedArtifactStore(backends.blobStore),
            cache: new DatabaseBackedCacheStore(backends.cache),
            runtimeEvents: new DatabaseBackedRuntimeEventStore(backends.database),
        };
    }

    getStore<K extends DextoStoreName>(name: K): DextoStoreMap[K] {
        return this.stores[name];
    }

    async connect(): Promise<void> {
        if (this.connected) {
            return;
        }

        await this.backends.cache.connect();
        await this.backends.database.connect();
        await this.backends.blobStore.connect();
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        if (!this.connected) {
            return;
        }

        await Promise.all([
            this.backends.cache.disconnect(),
            this.backends.database.disconnect(),
            this.backends.blobStore.disconnect(),
        ]);
        this.connected = false;
    }

    isConnected(): boolean {
        return (
            this.connected &&
            this.backends.cache.isConnected() &&
            this.backends.database.isConnected() &&
            this.backends.blobStore.isConnected()
        );
    }

    getStoreType(): string {
        return 'database-backed';
    }
}
