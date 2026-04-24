import { createHash, randomUUID } from 'crypto';
import type { ApprovalRequest, ApprovalResponse } from '../../approval/types.js';
import type { SessionApprovalState } from '../../approval/session-approval-store.js';
import type { InternalMessage } from '../../context/types.js';
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
    StoredArtifactMetadata,
} from '../artifacts/types.js';
import type { CacheStore } from '../cache-store/types.js';
import type { ConversationStore } from '../conversation/types.js';
import type { SessionMessageQueueStore } from '../message-queue/types.js';
import type { RuntimeEventRecord, RuntimeEventStore } from '../runtime-events/types.js';
import type { ToolPreferenceStore } from '../tool-preferences/types.js';
import { StorageError } from '../errors.js';
import type { DextoStoreMap, DextoStoreName, DextoStores } from './types.js';

const GLOBAL_SCOPE = 'global';

const DEFAULT_APPROVAL_STATE: SessionApprovalState = {
    toolPatterns: {},
    approvedDirectories: [],
};

const DEFAULT_TOOL_PREFERENCES: SessionToolPreferences = {
    userAutoApproveTools: [],
    disabledTools: [],
};

class InMemoryConversationStore implements ConversationStore {
    private readonly messages = new Map<string, InternalMessage[]>();

    async listMessages(input: { sessionId: string }): Promise<InternalMessage[]> {
        return structuredClone(this.messages.get(input.sessionId) ?? []);
    }

    async saveMessage(input: { sessionId: string; message: InternalMessage }): Promise<void> {
        const messages = this.messages.get(input.sessionId) ?? [];
        if (input.message.id && messages.some((message) => message.id === input.message.id)) {
            return;
        }

        messages.push(structuredClone(input.message));
        this.messages.set(input.sessionId, messages);
    }

    async updateMessage(input: { sessionId: string; message: InternalMessage }): Promise<void> {
        if (!input.message.id) {
            return;
        }

        const messages = this.messages.get(input.sessionId) ?? [];
        const index = messages.findIndex((message) => message.id === input.message.id);
        if (index === -1) {
            return;
        }

        messages[index] = structuredClone(input.message);
        this.messages.set(input.sessionId, messages);
    }

    async clearMessages(input: { sessionId: string }): Promise<void> {
        this.messages.delete(input.sessionId);
    }

    async flush(_input: { sessionId: string }): Promise<void> {}
}

class InMemoryApprovalStore implements ApprovalStore {
    private readonly requests = new Map<string, ApprovalRequest>();
    private readonly responses = new Map<string, ApprovalResponse>();
    private readonly sessionStates = new Map<string, SessionApprovalState>();

    async createRequest(input: { request: ApprovalRequest }): Promise<void> {
        this.requests.set(input.request.approvalId, structuredClone(input.request));
    }

    async getRequest(input: { approvalId: string }): Promise<ApprovalRequest | undefined> {
        const request = this.requests.get(input.approvalId);
        return request ? structuredClone(request) : undefined;
    }

    async listPending(input: { sessionId?: string }): Promise<ApprovalRequest[]> {
        const pending: ApprovalRequest[] = [];
        for (const request of this.requests.values()) {
            if (this.responses.has(request.approvalId)) {
                continue;
            }
            if (input.sessionId !== undefined && request.sessionId !== input.sessionId) {
                continue;
            }
            pending.push(structuredClone(request));
        }
        return pending;
    }

    async saveResponse(input: { response: ApprovalResponse }): Promise<void> {
        this.responses.set(input.response.approvalId, structuredClone(input.response));
    }

    async getResponse(input: { approvalId: string }): Promise<ApprovalResponse | undefined> {
        const response = this.responses.get(input.approvalId);
        return response ? structuredClone(response) : undefined;
    }

    async loadSessionState(input: { sessionId?: string }): Promise<SessionApprovalState> {
        return structuredClone(
            this.sessionStates.get(input.sessionId ?? GLOBAL_SCOPE) ?? DEFAULT_APPROVAL_STATE
        );
    }

    async saveSessionState(input: {
        sessionId?: string;
        state: SessionApprovalState;
    }): Promise<void> {
        this.sessionStates.set(input.sessionId ?? GLOBAL_SCOPE, structuredClone(input.state));
    }

    async deleteSessionState(input: { sessionId?: string }): Promise<void> {
        this.sessionStates.delete(input.sessionId ?? GLOBAL_SCOPE);
    }
}

class InMemoryToolPreferenceStore implements ToolPreferenceStore {
    private readonly allowedTools = new Map<string, Set<string>>();
    private readonly sessionPreferences = new Map<string, SessionToolPreferences>();

    async allowTool(input: { toolName: string; sessionId?: string }): Promise<void> {
        this.getAllowedToolSet(input.sessionId).add(input.toolName);
    }

    async disallowTool(input: { toolName: string; sessionId?: string }): Promise<void> {
        this.getAllowedToolSet(input.sessionId).delete(input.toolName);
    }

    async isToolAllowed(input: { toolName: string; sessionId?: string }): Promise<boolean> {
        return (
            this.getAllowedToolSet(input.sessionId).has(input.toolName) ||
            this.getAllowedToolSet(undefined).has(input.toolName)
        );
    }

    async listAllowedTools(input: { sessionId?: string }): Promise<string[]> {
        return Array.from(this.getAllowedToolSet(input.sessionId));
    }

    async loadSessionPreferences(input: { sessionId: string }): Promise<SessionToolPreferences> {
        return structuredClone(
            this.sessionPreferences.get(input.sessionId) ?? DEFAULT_TOOL_PREFERENCES
        );
    }

    async saveSessionPreferences(input: {
        sessionId: string;
        preferences: SessionToolPreferences;
    }): Promise<void> {
        this.sessionPreferences.set(input.sessionId, structuredClone(input.preferences));
    }

    async deleteSessionPreferences(input: { sessionId: string }): Promise<void> {
        this.sessionPreferences.delete(input.sessionId);
    }

    private getAllowedToolSet(sessionId: string | undefined): Set<string> {
        const key = sessionId ?? GLOBAL_SCOPE;
        const existing = this.allowedTools.get(key);
        if (existing) {
            return existing;
        }

        const tools = new Set<string>();
        this.allowedTools.set(key, tools);
        return tools;
    }
}

class InMemorySessionMessageQueueStore implements SessionMessageQueueStore {
    private readonly queues = new Map<string, QueuedMessage[]>();

    async load(input: { sessionId: string }): Promise<QueuedMessage[]> {
        return structuredClone(this.queues.get(input.sessionId) ?? []);
    }

    async save(input: { sessionId: string; queue: QueuedMessage[] }): Promise<void> {
        if (input.queue.length === 0) {
            this.queues.delete(input.sessionId);
            return;
        }

        this.queues.set(input.sessionId, structuredClone(input.queue));
    }

    async delete(input: { sessionId: string }): Promise<void> {
        this.queues.delete(input.sessionId);
    }
}

class InMemoryArtifactStore implements ArtifactStore {
    private readonly artifacts = new Map<
        string,
        { data: Buffer; metadata: StoredArtifactMetadata }
    >();

    async store(input: {
        data: ArtifactInput;
        metadata?: ArtifactMetadata;
    }): Promise<ArtifactReference> {
        const data = this.toBuffer(input.data);
        const id = randomUUID();
        const hash = createHash('sha256').update(data).digest('hex');
        const metadata = this.createMetadata(id, data, hash, input.metadata);
        this.artifacts.set(id, { data, metadata });
        return { id, uri: `artifact:${id}`, metadata: structuredClone(metadata) };
    }

    async retrieve(input: {
        reference: string;
        format?: 'base64' | 'buffer';
    }): Promise<ArtifactData> {
        const id = this.toId(input.reference);
        const artifact = this.artifacts.get(id);
        if (!artifact) {
            throw StorageError.blobNotFound(input.reference);
        }

        if (input.format === 'buffer') {
            return {
                format: 'buffer',
                data: Buffer.from(artifact.data),
                metadata: structuredClone(artifact.metadata),
            };
        }

        return {
            format: 'base64',
            data: artifact.data.toString('base64'),
            metadata: structuredClone(artifact.metadata),
        };
    }

    async exists(input: { reference: string }): Promise<boolean> {
        return this.artifacts.has(this.toId(input.reference));
    }

    async delete(input: { reference: string }): Promise<void> {
        this.artifacts.delete(this.toId(input.reference));
    }

    async cleanup(input: { olderThan?: Date } = {}): Promise<number> {
        let deleted = 0;
        for (const [id, artifact] of this.artifacts.entries()) {
            if (input.olderThan && artifact.metadata.createdAt >= input.olderThan) {
                continue;
            }
            this.artifacts.delete(id);
            deleted++;
        }
        return deleted;
    }

    async getStats(): Promise<ArtifactStats> {
        let totalSize = 0;
        for (const artifact of this.artifacts.values()) {
            totalSize += artifact.metadata.size;
        }
        return {
            count: this.artifacts.size,
            totalSize,
            backendType: 'in-memory',
        };
    }

    async listArtifacts(): Promise<ArtifactReference[]> {
        return Array.from(this.artifacts.values()).map((artifact) => ({
            id: artifact.metadata.id,
            uri: `artifact:${artifact.metadata.id}`,
            metadata: structuredClone(artifact.metadata),
        }));
    }

    getStoragePath(): string | undefined {
        return undefined;
    }

    private toBuffer(input: ArtifactInput): Buffer {
        if (typeof input === 'string') {
            return Buffer.from(input);
        }
        if (input instanceof Uint8Array) {
            return Buffer.from(input);
        }
        return Buffer.from(input);
    }

    private createMetadata(
        id: string,
        data: Buffer,
        hash: string,
        metadata: ArtifactMetadata | undefined
    ): StoredArtifactMetadata {
        return {
            id,
            mimeType: metadata?.mimeType ?? 'application/octet-stream',
            ...(metadata?.originalName !== undefined && { originalName: metadata.originalName }),
            createdAt: metadata?.createdAt ?? new Date(),
            size: metadata?.size ?? data.byteLength,
            hash,
            ...(metadata?.source !== undefined && { source: metadata.source }),
        };
    }

    private toId(reference: string): string {
        if (reference.startsWith('artifact:')) {
            return reference.slice('artifact:'.length);
        }
        return reference;
    }
}

type CacheEntry = {
    value: unknown;
    expiresAt?: number;
};

class InMemoryCacheStore implements CacheStore {
    private readonly entries = new Map<string, CacheEntry>();

    async get(input: { key: string }): Promise<unknown | undefined> {
        const entry = this.entries.get(input.key);
        if (!entry) {
            return undefined;
        }
        if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
            this.entries.delete(input.key);
            return undefined;
        }
        return structuredClone(entry.value);
    }

    async set(input: { key: string; value: unknown; ttlSeconds?: number }): Promise<void> {
        const entry: CacheEntry = {
            value: structuredClone(input.value),
            ...(input.ttlSeconds !== undefined && {
                expiresAt: Date.now() + input.ttlSeconds * 1000,
            }),
        };
        this.entries.set(input.key, entry);
    }

    async delete(input: { key: string }): Promise<void> {
        this.entries.delete(input.key);
    }
}

class InMemoryRuntimeEventStore implements RuntimeEventStore {
    private readonly events: RuntimeEventRecord[] = [];

    async append(input: { event: RuntimeEventRecord }): Promise<void> {
        this.events.push(structuredClone(input.event));
    }

    async list(input: {
        sessionId?: string;
        runId?: string;
        limit?: number;
    }): Promise<RuntimeEventRecord[]> {
        const events = this.events.filter((event) => {
            if (input.sessionId !== undefined && event.sessionId !== input.sessionId) {
                return false;
            }
            if (input.runId !== undefined && event.runId !== input.runId) {
                return false;
            }
            return true;
        });
        return structuredClone(input.limit === undefined ? events : events.slice(-input.limit));
    }
}

export class InMemoryDextoStores implements DextoStores {
    private connected = false;
    private readonly stores: DextoStoreMap = {
        conversation: new InMemoryConversationStore(),
        approvals: new InMemoryApprovalStore(),
        toolPreferences: new InMemoryToolPreferenceStore(),
        messageQueue: new InMemorySessionMessageQueueStore(),
        artifacts: new InMemoryArtifactStore(),
        cache: new InMemoryCacheStore(),
        runtimeEvents: new InMemoryRuntimeEventStore(),
    };

    getStore<K extends DextoStoreName>(name: K): DextoStoreMap[K] {
        return this.stores[name];
    }

    async connect(): Promise<void> {
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
    }

    isConnected(): boolean {
        return this.connected;
    }

    getStoreType(): string {
        return 'in-memory';
    }
}
