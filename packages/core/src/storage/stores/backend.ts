import type { ApprovalRequest, ApprovalResponse } from '../../approval/types.js';
import { ApprovalRequestSchema, ApprovalResponseSchema } from '../../approval/schemas.js';
import type { Memory } from '../../memory/types.js';
import type { StoredCustomPrompt } from '../../prompts/providers/custom-prompt-provider.js';
import { cloneQueuedMessages } from '../../session/queue-clone.js';
import type { SessionData } from '../../session/session-manager.js';
import { QueuedMessagesSchema } from '../../session/types.js';
import type { QueuedMessage } from '../../session/types.js';
import type { WorkspaceContext } from '../../workspace/types.js';
import {
    SessionToolPreferencesSchema,
    type SessionToolPreferences,
} from '../../tools/session-tool-preferences-store.js';
import {
    SessionApprovalStateSchema,
    type ApprovalStore,
    type SessionApprovalState,
} from '../approvals/types.js';
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
import type { Database } from '../database/types.js';
import type { MemoryStore } from '../memories/types.js';
import type { SessionMessageQueueStore } from '../message-queue/types.js';
import type { CustomPromptStore } from '../prompts/types.js';
import type { RuntimeEventRecord, RuntimeEventStore } from '../runtime-events/types.js';
import type { SessionStore } from '../sessions/types.js';
import type { ToolStateStore } from '../tool-state/types.js';
import type { ToolPreferenceStore } from '../tool-preferences/types.js';
import type { WorkspaceStore } from '../workspaces/types.js';
import type { DextoStoreMap, DextoStoreName, DextoStores } from './types.js';
import type { Logger } from '../../logger/v2/types.js';

const GLOBAL_SCOPE = 'global';
const MEMORY_KEY_PREFIX = 'memory:item:';
const CUSTOM_PROMPT_KEY_PREFIX = 'prompt:custom:';
const RUNTIME_EVENTS_KEY = 'runtime-events';
const RUNTIME_EVENTS_LIMIT = 10000;
const TOOL_STATE_KEY_PREFIX = 'tool-state:';
const WORKSPACE_KEY_PREFIX = 'workspace:item:';
const WORKSPACE_CURRENT_KEY = 'workspace:current';
export const SESSION_STEER_QUEUE_KEY_PREFIX = 'session-steer-queue';
export const SESSION_FOLLOW_UP_QUEUE_KEY_PREFIX = 'session-follow-up-queue';

type SessionMessageQueueKeyPrefix =
    | typeof SESSION_STEER_QUEUE_KEY_PREFIX
    | typeof SESSION_FOLLOW_UP_QUEUE_KEY_PREFIX;

const DEFAULT_APPROVAL_STATE: SessionApprovalState = {
    toolPatterns: {},
    approvedDirectories: [],
};

const DEFAULT_TOOL_PREFERENCES: SessionToolPreferences = {
    userAutoApproveTools: [],
    disabledTools: [],
};

export class DatabaseBackedArtifactStore implements ArtifactStore {
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

export class DatabaseBackedApprovalStore implements ApprovalStore {
    constructor(
        private readonly database: Database,
        private readonly cache: Cache,
        private readonly logger: Logger
    ) {}

    async createRequest(input: { request: ApprovalRequest }): Promise<ApprovalRequest> {
        const request = ApprovalRequestSchema.parse(input.request);
        const key = this.requestKey(request.approvalId);
        const stored = await this.database.setIfAbsent<ApprovalRequest>(key, request);
        return ApprovalRequestSchema.parse(stored.value);
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

    async saveResponse(input: {
        response: ApprovalResponse;
    }): Promise<{ response: ApprovalResponse; status: 'created' | 'replayed' }> {
        const response = ApprovalResponseSchema.parse(input.response);
        const key = this.responseKey(response.approvalId);
        const stored = await this.database.setIfAbsent<ApprovalResponse>(key, response);
        return {
            response: ApprovalResponseSchema.parse(stored.value),
            status: stored.inserted ? 'created' : 'replayed',
        };
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

export class DatabaseBackedSessionStore implements SessionStore {
    constructor(
        private readonly database: Database,
        private readonly cache: Cache
    ) {}

    async listSessionIds(): Promise<string[]> {
        const keys = await this.database.list('session:');
        return keys.map((key) => key.replace('session:', ''));
    }

    async getSession(input: { sessionId: string }): Promise<SessionData | undefined> {
        const key = this.key(input.sessionId);
        const cached = await this.cache.get<SessionData>(key);
        if (cached !== undefined) {
            return structuredClone(cached);
        }

        const session = await this.database.get<SessionData>(key);
        return session ? structuredClone(session) : undefined;
    }

    async saveSession(input: {
        sessionId: string;
        session: SessionData;
        ttlSeconds?: number;
    }): Promise<void> {
        const key = this.key(input.sessionId);
        await this.database.set(key, input.session);
        await this.cache.set(key, input.session, input.ttlSeconds);
    }

    async deleteSession(input: { sessionId: string }): Promise<void> {
        const key = this.key(input.sessionId);
        await Promise.all([this.database.delete(key), this.cache.delete(key)]);
    }

    async evictSession(input: { sessionId: string }): Promise<void> {
        await this.cache.delete(this.key(input.sessionId));
    }

    private key(sessionId: string): string {
        return `session:${sessionId}`;
    }
}

export class DatabaseBackedMemoryStore implements MemoryStore {
    constructor(private readonly database: Database) {}

    async create(input: { memory: Memory }): Promise<void> {
        await this.database.set(this.key(input.memory.id), input.memory);
    }

    async get(input: { id: string }): Promise<Memory | undefined> {
        return await this.database.get<Memory>(this.key(input.id));
    }

    async update(input: { memory: Memory }): Promise<void> {
        await this.database.set(this.key(input.memory.id), input.memory);
    }

    async delete(input: { id: string }): Promise<void> {
        await this.database.delete(this.key(input.id));
    }

    async list(): Promise<Memory[]> {
        const keys = await this.database.list(MEMORY_KEY_PREFIX);
        const memories: Memory[] = [];
        for (const key of keys) {
            const memory = await this.database.get<Memory>(key);
            if (memory) {
                memories.push(memory);
            }
        }
        return memories;
    }

    private key(id: string): string {
        return `${MEMORY_KEY_PREFIX}${id}`;
    }
}

export class DatabaseBackedWorkspaceStore implements WorkspaceStore {
    constructor(private readonly database: Database) {}

    async saveWorkspace(input: { workspace: WorkspaceContext }): Promise<void> {
        await this.database.set(this.key(input.workspace.id), input.workspace);
    }

    async getWorkspace(input: { id: string }): Promise<WorkspaceContext | undefined> {
        return await this.database.get<WorkspaceContext>(this.key(input.id));
    }

    async findWorkspaceByPath(input: { path: string }): Promise<WorkspaceContext | undefined> {
        const workspaces = await this.listWorkspaces();
        return workspaces.find((workspace) => workspace.path === input.path);
    }

    async listWorkspaces(): Promise<WorkspaceContext[]> {
        const keys = await this.database.list(WORKSPACE_KEY_PREFIX);
        const workspaces: WorkspaceContext[] = [];
        for (const key of keys) {
            const workspace = await this.database.get<WorkspaceContext>(key);
            if (workspace) {
                workspaces.push(workspace);
            }
        }
        return workspaces;
    }

    async setCurrentWorkspace(input: { id: string }): Promise<void> {
        await this.database.set(WORKSPACE_CURRENT_KEY, input.id);
    }

    async getCurrentWorkspaceId(): Promise<string | undefined> {
        return await this.database.get<string>(WORKSPACE_CURRENT_KEY);
    }

    async clearCurrentWorkspace(): Promise<void> {
        await this.database.delete(WORKSPACE_CURRENT_KEY);
    }

    private key(id: string): string {
        return `${WORKSPACE_KEY_PREFIX}${id}`;
    }
}

export class DatabaseBackedToolPreferenceStore implements ToolPreferenceStore {
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

export class DatabaseBackedSessionMessageQueueStore implements SessionMessageQueueStore {
    constructor(
        private readonly database: Database,
        private readonly cache: Cache,
        private readonly logger: Logger,
        private readonly keyPrefix: SessionMessageQueueKeyPrefix
    ) {}

    async listSessionIds(): Promise<string[]> {
        const prefix = `${this.keyPrefix}:`;
        const keys = await this.database.list(prefix);
        return keys.map((key) => key.replace(prefix, ''));
    }

    async load(input: { sessionId: string }): Promise<QueuedMessage[]> {
        const key = this.key(input.sessionId);
        const cached = await this.cache.get<unknown>(key);
        const cachedQueue = QueuedMessagesSchema.safeParse(cached);
        if (cachedQueue.success) {
            return cloneQueuedMessages(cachedQueue.data);
        }

        const stored = await this.database.get<unknown>(key);
        const storedQueue = QueuedMessagesSchema.safeParse(stored);
        if (!storedQueue.success) {
            if (stored !== undefined) {
                this.logger.warn('Invalid persisted message queue encountered; ignoring state', {
                    key,
                });
            }
            return [];
        }

        const queue = cloneQueuedMessages(storedQueue.data);
        await this.cache.set(key, queue, 3600);
        return cloneQueuedMessages(queue);
    }

    async save(input: { sessionId: string; queue: QueuedMessage[] }): Promise<void> {
        const key = this.key(input.sessionId);
        if (input.queue.length === 0) {
            await this.delete({ sessionId: input.sessionId });
            return;
        }

        const queue = cloneQueuedMessages(input.queue);
        await this.database.set(key, queue);
        await this.cache.set(key, queue, 3600);
    }

    async delete(input: { sessionId: string }): Promise<void> {
        const key = this.key(input.sessionId);
        await Promise.all([this.database.delete(key), this.cache.delete(key)]);
    }

    private key(sessionId: string): string {
        return `${this.keyPrefix}:${sessionId}`;
    }
}

export class DatabaseBackedCustomPromptStore implements CustomPromptStore {
    constructor(private readonly database: Database) {}

    async save(input: { prompt: StoredCustomPrompt }): Promise<void> {
        await this.database.set(this.key(input.prompt.name), input.prompt);
    }

    async get(input: { name: string }): Promise<StoredCustomPrompt | undefined> {
        return await this.database.get<StoredCustomPrompt>(this.key(input.name));
    }

    async delete(input: { name: string }): Promise<void> {
        await this.database.delete(this.key(input.name));
    }

    async list(): Promise<StoredCustomPrompt[]> {
        const keys = await this.database.list(CUSTOM_PROMPT_KEY_PREFIX);
        const prompts: StoredCustomPrompt[] = [];
        for (const key of keys) {
            const prompt = await this.database.get<StoredCustomPrompt>(key);
            if (prompt) {
                prompts.push(prompt);
            }
        }
        return prompts;
    }

    private key(name: string): string {
        return `${CUSTOM_PROMPT_KEY_PREFIX}${name}`;
    }
}

export class DatabaseBackedRuntimeEventStore implements RuntimeEventStore {
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

export class DatabaseBackedToolStateStore implements ToolStateStore {
    constructor(private readonly database: Database) {}

    async get<T>(input: { toolName: string; key: string }): Promise<T | undefined> {
        return await this.database.get<T>(this.toKey(input));
    }

    async set<T>(input: { toolName: string; key: string; value: T }): Promise<void> {
        await this.database.set(this.toKey(input), input.value);
    }

    async delete(input: { toolName: string; key: string }): Promise<void> {
        await this.database.delete(this.toKey(input));
    }

    async listKeys(input: { toolName: string; prefix?: string }): Promise<string[]> {
        const prefix = this.toKey({ toolName: input.toolName, key: input.prefix ?? '' });
        return (await this.database.list(prefix)).map((key) =>
            key.slice(this.scopePrefix(input.toolName).length)
        );
    }

    private toKey(input: { toolName: string; key: string }): string {
        return `${this.scopePrefix(input.toolName)}${input.key}`;
    }

    private scopePrefix(toolName: string): string {
        return `${TOOL_STATE_KEY_PREFIX}${toolName}:`;
    }
}

export interface DextoStoresLifecycle {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
}

const NOOP_LIFECYCLE: DextoStoresLifecycle = {
    async connect(): Promise<void> {},
    async disconnect(): Promise<void> {},
    isConnected(): boolean {
        return true;
    },
};

export class BackendDextoStores implements DextoStores {
    private connected = false;

    constructor(
        private readonly stores: DextoStoreMap,
        private readonly lifecycle: DextoStoresLifecycle = NOOP_LIFECYCLE,
        private readonly storeType = 'backend'
    ) {}

    getStore<K extends DextoStoreName>(name: K): DextoStoreMap[K] {
        return this.stores[name];
    }

    async connect(): Promise<void> {
        if (this.connected) {
            return;
        }

        await this.lifecycle.connect();
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        if (!this.connected) {
            return;
        }

        await this.lifecycle.disconnect();
        this.connected = false;
    }

    isConnected(): boolean {
        return this.connected && this.lifecycle.isConnected();
    }

    getStoreType(): string {
        return this.storeType;
    }
}
