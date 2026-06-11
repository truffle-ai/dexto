import { createHash, randomUUID } from 'crypto';
import type { ApprovalRequest, ApprovalResponse } from '../../approval/types.js';
import { cloneInternalMessage, cloneInternalMessages } from '../../context/content-clone.js';
import type { InternalMessage } from '../../context/types.js';
import type { Memory } from '../../memory/types.js';
import type { StoredCustomPrompt } from '../../prompts/providers/custom-prompt-provider.js';
import { cloneQueuedMessage, cloneQueuedMessages } from '../../session/queue-clone.js';
import type { SessionData } from '../../session/session-manager.js';
import type { QueuedMessage } from '../../session/types.js';
import type { WorkspaceContext } from '../../workspace/types.js';
import type { SessionToolPreferences } from '../../tools/session-tool-preferences-store.js';
import type { ApprovalStore, SessionApprovalState } from '../approvals/types.js';
import type {
    ArtifactData,
    ArtifactInput,
    ArtifactMetadata,
    ArtifactReference,
    ArtifactStats,
    ArtifactStore,
    StoredArtifactMetadata,
} from '../artifacts/types.js';
import type { ConversationStore } from '../conversation/types.js';
import type { MemoryStore } from '../memories/types.js';
import type { SessionMessageQueueStore } from '../message-queue/types.js';
import type { CustomPromptStore } from '../prompts/types.js';
import type { RuntimeEventRecord, RuntimeEventStore } from '../runtime-events/types.js';
import type { SessionStore } from '../sessions/types.js';
import type {
    ToolExecutionCancelledRecord,
    ToolExecutionCompletedRecord,
    ToolExecutionFailedRecord,
    ToolExecutionRecord,
    ToolExecutionRunningRecord,
    ToolExecutionStartResult,
    ToolExecutionStore,
} from '../tool-executions/types.js';
import { splitToolExecutionResult } from '../tool-executions/types.js';
import type { ToolStateStore } from '../tool-state/types.js';
import type { ToolPreferenceStore } from '../tool-preferences/types.js';
import type { WorkspaceStore } from '../workspaces/types.js';
import type { ToolExecutionResult } from '../../tools/types.js';
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
        return cloneInternalMessages(this.messages.get(input.sessionId) ?? []);
    }

    async saveMessage(input: { sessionId: string; message: InternalMessage }): Promise<void> {
        const messages = this.messages.get(input.sessionId) ?? [];
        if (input.message.id && messages.some((message) => message.id === input.message.id)) {
            return;
        }

        messages.push(cloneInternalMessage(input.message));
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

        messages[index] = cloneInternalMessage(input.message);
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

    async createRequest(input: { request: ApprovalRequest }): Promise<ApprovalRequest> {
        const existing = this.requests.get(input.request.approvalId);
        if (existing) {
            return structuredClone(existing);
        }
        this.requests.set(input.request.approvalId, structuredClone(input.request));
        return structuredClone(input.request);
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

    async saveResponse(input: {
        response: ApprovalResponse;
    }): Promise<{ response: ApprovalResponse; status: 'created' | 'replayed' }> {
        const existing = this.responses.get(input.response.approvalId);
        if (existing) {
            return { response: structuredClone(existing), status: 'replayed' };
        }
        this.responses.set(input.response.approvalId, structuredClone(input.response));
        return { response: structuredClone(input.response), status: 'created' };
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

class InMemorySessionStore implements SessionStore {
    private readonly sessions = new Map<string, SessionData>();

    async listSessionIds(): Promise<string[]> {
        return Array.from(this.sessions.keys());
    }

    async getSession(input: { sessionId: string }): Promise<SessionData | undefined> {
        const session = this.sessions.get(input.sessionId);
        return session ? structuredClone(session) : undefined;
    }

    async saveSession(input: {
        sessionId: string;
        session: SessionData;
        ttlSeconds?: number;
    }): Promise<void> {
        void input.ttlSeconds;
        this.sessions.set(input.sessionId, structuredClone(input.session));
    }

    async deleteSession(input: { sessionId: string }): Promise<void> {
        this.sessions.delete(input.sessionId);
    }

    async evictSession(_input: { sessionId: string }): Promise<void> {}
}

class InMemoryMemoryStore implements MemoryStore {
    private readonly memories = new Map<string, Memory>();

    async create(input: { memory: Memory }): Promise<void> {
        this.memories.set(input.memory.id, structuredClone(input.memory));
    }

    async get(input: { id: string }): Promise<Memory | undefined> {
        const memory = this.memories.get(input.id);
        return memory ? structuredClone(memory) : undefined;
    }

    async update(input: { memory: Memory }): Promise<void> {
        this.memories.set(input.memory.id, structuredClone(input.memory));
    }

    async delete(input: { id: string }): Promise<void> {
        this.memories.delete(input.id);
    }

    async list(): Promise<Memory[]> {
        return structuredClone(Array.from(this.memories.values()));
    }
}

class InMemoryWorkspaceStore implements WorkspaceStore {
    private readonly workspaces = new Map<string, WorkspaceContext>();
    private currentWorkspaceId: string | undefined;

    async saveWorkspace(input: { workspace: WorkspaceContext }): Promise<void> {
        this.workspaces.set(input.workspace.id, structuredClone(input.workspace));
    }

    async getWorkspace(input: { id: string }): Promise<WorkspaceContext | undefined> {
        const workspace = this.workspaces.get(input.id);
        return workspace ? structuredClone(workspace) : undefined;
    }

    async findWorkspaceByPath(input: { path: string }): Promise<WorkspaceContext | undefined> {
        for (const workspace of this.workspaces.values()) {
            if (workspace.path === input.path) {
                return structuredClone(workspace);
            }
        }
        return undefined;
    }

    async listWorkspaces(): Promise<WorkspaceContext[]> {
        return structuredClone(Array.from(this.workspaces.values()));
    }

    async setCurrentWorkspace(input: { id: string }): Promise<void> {
        this.currentWorkspaceId = input.id;
    }

    async getCurrentWorkspaceId(): Promise<string | undefined> {
        return this.currentWorkspaceId;
    }

    async clearCurrentWorkspace(): Promise<void> {
        this.currentWorkspaceId = undefined;
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

    async list(input: { sessionId: string }): Promise<QueuedMessage[]> {
        return cloneQueuedMessages(this.queues.get(input.sessionId) ?? []);
    }

    async append(input: {
        sessionId: string;
        message: QueuedMessage;
    }): Promise<{ position: number }> {
        const queue = [
            ...(this.queues.get(input.sessionId) ?? []),
            cloneQueuedMessage(input.message),
        ];
        this.queues.set(input.sessionId, queue);
        return { position: queue.length };
    }

    async takeAll(input: { sessionId: string }): Promise<QueuedMessage[]> {
        const queue = cloneQueuedMessages(this.queues.get(input.sessionId) ?? []);
        this.queues.delete(input.sessionId);
        return queue;
    }

    async remove(input: { sessionId: string; id: string }): Promise<boolean> {
        const queue = this.queues.get(input.sessionId) ?? [];
        const updatedQueue = queue.filter((message) => message.id !== input.id);
        if (updatedQueue.length === queue.length) {
            return false;
        }
        if (updatedQueue.length === 0) {
            this.queues.delete(input.sessionId);
        } else {
            this.queues.set(input.sessionId, updatedQueue);
        }
        return true;
    }

    async clear(input: { sessionId: string }): Promise<void> {
        this.queues.delete(input.sessionId);
    }
}

class InMemoryCustomPromptStore implements CustomPromptStore {
    private readonly prompts = new Map<string, StoredCustomPrompt>();

    async save(input: { prompt: StoredCustomPrompt }): Promise<void> {
        this.prompts.set(input.prompt.name, structuredClone(input.prompt));
    }

    async get(input: { name: string }): Promise<StoredCustomPrompt | undefined> {
        const prompt = this.prompts.get(input.name);
        return prompt ? structuredClone(prompt) : undefined;
    }

    async delete(input: { name: string }): Promise<void> {
        this.prompts.delete(input.name);
    }

    async list(): Promise<StoredCustomPrompt[]> {
        return structuredClone(Array.from(this.prompts.values()));
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
        return { id, uri: `blob:${id}`, metadata: structuredClone(metadata) };
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
            uri: `blob:${artifact.metadata.id}`,
            metadata: structuredClone(artifact.metadata),
        }));
    }

    getStoragePath(): string | undefined {
        return undefined;
    }

    private toBuffer(input: ArtifactInput): Buffer {
        if (typeof input === 'string') {
            return Buffer.from(input, 'base64');
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
        if (reference.startsWith('blob:')) {
            return reference.slice('blob:'.length);
        }
        return reference;
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

class InMemoryToolStateStore implements ToolStateStore {
    private readonly values = new Map<string, unknown>();

    async get<T>(input: { toolName: string; key: string }): Promise<T | undefined> {
        return structuredClone(this.values.get(this.toKey(input))) as T | undefined;
    }

    async set<T>(input: { toolName: string; key: string; value: T }): Promise<void> {
        this.values.set(this.toKey(input), structuredClone(input.value));
    }

    async delete(input: { toolName: string; key: string }): Promise<void> {
        this.values.delete(this.toKey(input));
    }

    async listKeys(input: { toolName: string; prefix?: string }): Promise<string[]> {
        const prefix = this.toKey({ toolName: input.toolName, key: input.prefix ?? '' });
        return Array.from(this.values.keys())
            .filter((key) => key.startsWith(prefix))
            .map((key) => key.slice(this.toKey({ toolName: input.toolName, key: '' }).length));
    }

    private toKey(input: { toolName: string; key: string }): string {
        return `${input.toolName}:${input.key}`;
    }
}

class InMemoryToolExecutionStore implements ToolExecutionStore {
    private readonly records = new Map<string, ToolExecutionRecord>();

    async get(input: { executionId: string }): Promise<ToolExecutionRecord | undefined> {
        const record = this.records.get(input.executionId);
        return record ? structuredClone(record) : undefined;
    }

    async start(input: { record: ToolExecutionRunningRecord }): Promise<ToolExecutionStartResult> {
        const existing = this.records.get(input.record.executionId);
        if (existing) {
            return { status: 'existing', record: structuredClone(existing) };
        }

        this.records.set(input.record.executionId, structuredClone(input.record));
        return { status: 'started', record: structuredClone(input.record) };
    }

    async complete(input: {
        executionId: string;
        completedAt: Date;
        result: ToolExecutionResult;
    }): Promise<ToolExecutionCompletedRecord> {
        const existing = this.requireRecord(input.executionId);
        if (existing.status === 'completed') {
            return structuredClone(existing);
        }
        if (existing.status !== 'running') {
            throw new Error(`Tool execution is already ${existing.status}: ${input.executionId}`);
        }
        const resultParts = splitToolExecutionResult(input.result);
        const record: ToolExecutionCompletedRecord = {
            ...existing,
            status: 'completed',
            completedAt: input.completedAt,
            updatedAt: input.completedAt,
            ...resultParts,
        };
        this.records.set(input.executionId, structuredClone(record));
        return structuredClone(record);
    }

    async fail(input: {
        executionId: string;
        completedAt: Date;
        error: string;
    }): Promise<ToolExecutionFailedRecord> {
        const existing = this.requireRecord(input.executionId);
        if (existing.status === 'failed') {
            return structuredClone(existing);
        }
        if (existing.status !== 'running') {
            throw new Error(`Tool execution is already ${existing.status}: ${input.executionId}`);
        }
        const record: ToolExecutionFailedRecord = {
            ...existing,
            status: 'failed',
            completedAt: input.completedAt,
            updatedAt: input.completedAt,
            error: input.error,
        };
        this.records.set(input.executionId, structuredClone(record));
        return structuredClone(record);
    }

    async cancel(input: {
        executionId: string;
        completedAt: Date;
        reason?: string;
    }): Promise<ToolExecutionCancelledRecord> {
        const existing = this.requireRecord(input.executionId);
        if (existing.status === 'cancelled') {
            return structuredClone(existing);
        }
        if (existing.status !== 'running') {
            throw new Error(`Tool execution is already ${existing.status}: ${input.executionId}`);
        }
        const record: ToolExecutionCancelledRecord = {
            ...existing,
            status: 'cancelled',
            completedAt: input.completedAt,
            updatedAt: input.completedAt,
            ...(input.reason !== undefined ? { reason: input.reason } : {}),
        };
        this.records.set(input.executionId, structuredClone(record));
        return structuredClone(record);
    }

    private requireRecord(executionId: string): ToolExecutionRecord {
        const existing = this.records.get(executionId);
        if (!existing) {
            throw new Error(`Tool execution record not found: ${executionId}`);
        }
        return existing;
    }
}

export class InMemoryDextoStores implements DextoStores {
    private connected = false;
    private readonly stores: DextoStoreMap = {
        conversation: new InMemoryConversationStore(),
        sessions: new InMemorySessionStore(),
        memories: new InMemoryMemoryStore(),
        workspaces: new InMemoryWorkspaceStore(),
        approvals: new InMemoryApprovalStore(),
        toolPreferences: new InMemoryToolPreferenceStore(),
        toolState: new InMemoryToolStateStore(),
        steerQueue: new InMemorySessionMessageQueueStore(),
        followUpQueue: new InMemorySessionMessageQueueStore(),
        customPrompts: new InMemoryCustomPromptStore(),
        artifacts: new InMemoryArtifactStore(),
        runtimeEvents: new InMemoryRuntimeEventStore(),
        toolExecutions: new InMemoryToolExecutionStore(),
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
