import { describe, expect, it } from 'vitest';
import { createMockLogger } from '../../logger/v2/test-utils.js';
import { createApprovalRequest } from '../../approval/factory.js';
import { ApprovalType } from '../../approval/types.js';
import {
    createInMemoryBlobStore,
    createInMemoryCache,
    createInMemoryDatabase,
} from '../../test-utils/in-memory-storage.js';
import { DatabaseConversationStore } from '../conversation/database.js';
import {
    BackendDextoStores,
    DatabaseBackedArtifactStore,
    DatabaseBackedApprovalStore,
    DatabaseBackedCustomPromptStore,
    DatabaseBackedMemoryStore,
    DatabaseBackedRuntimeEventStore,
    DatabaseBackedSessionMessageQueueStore,
    DatabaseBackedSessionStore,
    DatabaseBackedToolExecutionStore,
    DatabaseBackedToolPreferenceStore,
    DatabaseBackedToolStateStore,
    DatabaseBackedWorkspaceStore,
    SESSION_FOLLOW_UP_QUEUE_KEY_PREFIX,
    SESSION_STEER_QUEUE_KEY_PREFIX,
} from './backend.js';
import { createToolExecutionId } from '../tool-executions/types.js';

describe('BackendDextoStores', () => {
    it('adapts existing database, cache, and blob backends into typed stores', async () => {
        const database = createInMemoryDatabase();
        const cache = createInMemoryCache();
        const blobStore = createInMemoryBlobStore();
        const logger = createMockLogger();
        const stores = new BackendDextoStores(
            {
                conversation: new DatabaseConversationStore(database, logger),
                sessions: new DatabaseBackedSessionStore(database, cache),
                memories: new DatabaseBackedMemoryStore(database),
                workspaces: new DatabaseBackedWorkspaceStore(database),
                approvals: new DatabaseBackedApprovalStore(database, cache, logger),
                toolPreferences: new DatabaseBackedToolPreferenceStore(database, cache, logger),
                toolState: new DatabaseBackedToolStateStore(database),
                steerQueue: new DatabaseBackedSessionMessageQueueStore(
                    database,
                    logger,
                    SESSION_STEER_QUEUE_KEY_PREFIX
                ),
                followUpQueue: new DatabaseBackedSessionMessageQueueStore(
                    database,
                    logger,
                    SESSION_FOLLOW_UP_QUEUE_KEY_PREFIX
                ),
                customPrompts: new DatabaseBackedCustomPromptStore(database),
                artifacts: new DatabaseBackedArtifactStore(blobStore),
                runtimeEvents: new DatabaseBackedRuntimeEventStore(database),
                toolExecutions: new DatabaseBackedToolExecutionStore(database),
            },
            {
                async connect(): Promise<void> {
                    await cache.connect();
                    await database.connect();
                    await blobStore.connect();
                },
                async disconnect(): Promise<void> {
                    await Promise.all([
                        cache.disconnect(),
                        database.disconnect(),
                        blobStore.disconnect(),
                    ]);
                },
                isConnected(): boolean {
                    return cache.isConnected() && database.isConnected() && blobStore.isConnected();
                },
            }
        );

        await stores.connect();
        expect(stores.isConnected()).toBe(true);

        await stores.getStore('conversation').saveMessage({
            sessionId: 'session-1',
            message: {
                id: 'message-1',
                role: 'user',
                content: [{ type: 'text', text: 'hello' }],
                timestamp: 1,
            },
        });
        await stores.getStore('steerQueue').append({
            sessionId: 'session-1',
            message: {
                id: 'queued-1',
                content: [{ type: 'text', text: 'next' }],
                queuedAt: 2,
            },
        });
        await stores.getStore('followUpQueue').append({
            sessionId: 'session-1',
            message: {
                id: 'follow-up-1',
                content: [{ type: 'text', text: 'later' }],
                queuedAt: 3,
            },
        });
        await stores.getStore('toolPreferences').allowTool({
            sessionId: 'session-1',
            toolName: 'todo_write',
        });
        const artifact = await stores.getStore('artifacts').store({
            data: Buffer.from('artifact'),
            metadata: { mimeType: 'text/plain' },
        });

        expect(await database.getRange('messages:session-1', 0, 10)).toHaveLength(1);
        expect(await stores.getStore('steerQueue').list({ sessionId: 'session-1' })).toEqual([
            {
                id: 'queued-1',
                content: [{ type: 'text', text: 'next' }],
                queuedAt: 2,
            },
        ]);
        expect(await stores.getStore('followUpQueue').list({ sessionId: 'session-1' })).toEqual([
            {
                id: 'follow-up-1',
                content: [{ type: 'text', text: 'later' }],
                queuedAt: 3,
            },
        ]);
        expect(
            await stores.getStore('toolPreferences').isToolAllowed({
                sessionId: 'session-1',
                toolName: 'todo_write',
            })
        ).toBe(true);
        expect(await blobStore.exists(artifact.uri)).toBe(true);

        await stores.disconnect();
        expect(stores.isConnected()).toBe(false);
    });

    it('preserves message queue append order instead of sorting by queuedAt', async () => {
        const database = createInMemoryDatabase();
        const logger = createMockLogger();
        const steerQueue = new DatabaseBackedSessionMessageQueueStore(
            database,
            logger,
            SESSION_STEER_QUEUE_KEY_PREFIX
        );

        await steerQueue.append({
            sessionId: 'session-append-order',
            message: {
                id: 'queued-later-timestamp',
                content: [{ type: 'text', text: 'first append' }],
                queuedAt: 2,
            },
        });
        await steerQueue.append({
            sessionId: 'session-append-order',
            message: {
                id: 'queued-earlier-timestamp',
                content: [{ type: 'text', text: 'second append' }],
                queuedAt: 1,
            },
        });

        expect(
            (await steerQueue.list({ sessionId: 'session-append-order' })).map(
                (message) => message.id
            )
        ).toEqual(['queued-later-timestamp', 'queued-earlier-timestamp']);
    });

    it('reads persisted message queues beyond one backend page', async () => {
        const database = createInMemoryDatabase();
        const logger = createMockLogger();
        const steerQueue = new DatabaseBackedSessionMessageQueueStore(
            database,
            logger,
            SESSION_STEER_QUEUE_KEY_PREFIX
        );
        const queuedMessages = Array.from({ length: 10001 }, (_, index) => ({
            id: `queued-${index}`,
            content: [{ type: 'text' as const, text: `message ${index}` }],
            queuedAt: index,
        }));
        await database.set('session-steer-queue:session-paged', queuedMessages);

        await expect(steerQueue.list({ sessionId: 'session-paged' })).resolves.toHaveLength(10001);
    });
});

describe('DatabaseBackedApprovalStore', () => {
    it('reads approval requests after JSON-backed timestamp round trips', async () => {
        const database = createInMemoryDatabase();
        const cache = createInMemoryCache();
        const store = new DatabaseBackedApprovalStore(database, cache, createMockLogger());
        const request = createApprovalRequest({
            type: ApprovalType.TOOL_APPROVAL,
            sessionId: 'session-1',
            metadata: {
                toolName: 'write_file',
                toolCallId: 'call-1',
                args: { path: 'src/app.ts' },
            },
        });

        await database.set(
            `approval-request:${request.approvalId}`,
            JSON.parse(JSON.stringify(request))
        );

        await expect(store.getRequest({ approvalId: request.approvalId })).resolves.toEqual(
            request
        );
    });

    it('returns the stored approval request when concurrent writers race on one id', async () => {
        const database = createInMemoryDatabase();
        const cache = createInMemoryCache();
        const logger = createMockLogger();
        const firstStore = new DatabaseBackedApprovalStore(database, cache, logger);
        const secondStore = new DatabaseBackedApprovalStore(database, cache, logger);
        const firstRequest = createApprovalRequest({
            type: ApprovalType.TOOL_APPROVAL,
            sessionId: 'session-1',
            metadata: {
                toolName: 'write_file',
                toolCallId: 'call-1',
                args: { path: 'src/app.ts' },
            },
        });
        const secondRequest = createApprovalRequest(
            {
                type: ApprovalType.TOOL_APPROVAL,
                sessionId: 'session-2',
                metadata: {
                    toolName: 'write_file',
                    toolCallId: 'call-1',
                    args: { path: 'src/app.ts' },
                },
            },
            firstRequest.approvalId
        );

        const [firstRecorded, secondRecorded] = await Promise.all([
            firstStore.createRequest({ request: firstRequest }),
            secondStore.createRequest({ request: secondRequest }),
        ]);

        expect(firstRecorded).toEqual(firstRequest);
        expect(secondRecorded).toEqual(firstRequest);
        await expect(
            firstStore.getRequest({ approvalId: firstRequest.approvalId })
        ).resolves.toEqual(firstRequest);
    });

    it('returns the stored approval response when concurrent writers race on one id', async () => {
        const database = createInMemoryDatabase();
        const cache = createInMemoryCache();
        const store = new DatabaseBackedApprovalStore(database, cache, createMockLogger());
        const request = createApprovalRequest({
            type: ApprovalType.TOOL_APPROVAL,
            sessionId: 'session-1',
            metadata: {
                toolName: 'write_file',
                toolCallId: 'call-1',
                args: { path: 'src/app.ts' },
            },
        });
        await store.createRequest({ request });

        const approved = {
            approvalId: request.approvalId,
            sessionId: 'session-1',
            status: 'approved' as const,
        };
        const denied = {
            approvalId: request.approvalId,
            sessionId: 'session-1',
            status: 'denied' as const,
            reason: 'user_denied' as const,
        };

        const [firstRecorded, secondRecorded] = await Promise.all([
            store.saveResponse({ response: approved }),
            store.saveResponse({ response: denied }),
        ]);

        expect([firstRecorded, secondRecorded]).toContainEqual({
            response: approved,
            status: 'created',
        });
        expect([firstRecorded, secondRecorded]).toContainEqual({
            response: approved,
            status: 'replayed',
        });
        await expect(store.getResponse({ approvalId: request.approvalId })).resolves.toEqual(
            approved
        );
    });
});

describe('DatabaseBackedToolExecutionStore', () => {
    it('records one running execution when concurrent writers race on one id', async () => {
        const database = createInMemoryDatabase();
        const firstStore = new DatabaseBackedToolExecutionStore(database);
        const secondStore = new DatabaseBackedToolExecutionStore(database);
        const startedAt = new Date('2026-05-11T00:00:00.000Z');
        const identity = {
            runId: 'run-1',
            turnId: 'turn-1',
            modelStepId: 'step-1',
            toolCallId: 'call-1',
        };
        const record = {
            executionId: createToolExecutionId(identity),
            identity,
            input: { path: 'src/app.ts' },
            toolName: 'write_file',
            status: 'running' as const,
            startedAt,
            updatedAt: startedAt,
        };

        const [first, second] = await Promise.all([
            firstStore.start({ record }),
            secondStore.start({ record }),
        ]);

        expect([first.status, second.status].sort()).toEqual(['existing', 'started']);
        await expect(firstStore.get({ executionId: record.executionId })).resolves.toEqual(record);
    });

    it('persists completed model output separately from UI metadata', async () => {
        const database = createInMemoryDatabase();
        const store = new DatabaseBackedToolExecutionStore(database);
        const startedAt = new Date('2026-05-11T00:00:00.000Z');
        const completedAt = new Date('2026-05-11T00:00:01.000Z');
        const identity = {
            runId: 'run-1',
            turnId: 'turn-1',
            modelStepId: 'step-1',
            toolCallId: 'call-1',
        };
        const record = {
            executionId: createToolExecutionId(identity),
            identity,
            input: { path: 'src/app.ts' },
            toolName: 'write_file',
            status: 'running' as const,
            startedAt,
            updatedAt: startedAt,
        };

        await store.start({ record });
        await store.complete({
            executionId: record.executionId,
            completedAt,
            result: {
                result: { ok: true },
                presentationSnapshot: {
                    version: 1,
                    source: { type: 'local' },
                    header: { title: 'Write File' },
                },
                requireApproval: true,
                approvalStatus: 'approved',
            },
        });

        await expect(store.get({ executionId: record.executionId })).resolves.toEqual({
            ...record,
            status: 'completed',
            updatedAt: completedAt,
            completedAt,
            modelOutput: { ok: true },
            resultMetadata: {
                presentationSnapshot: {
                    version: 1,
                    source: { type: 'local' },
                    header: { title: 'Write File' },
                },
                requireApproval: true,
                approvalStatus: 'approved',
            },
        });
    });

    it('does not overwrite a completed execution with a later failure', async () => {
        const database = createInMemoryDatabase();
        const store = new DatabaseBackedToolExecutionStore(database);
        const startedAt = new Date('2026-05-11T00:00:00.000Z');
        const completedAt = new Date('2026-05-11T00:00:01.000Z');
        const identity = {
            runId: 'run-1',
            turnId: 'turn-1',
            modelStepId: 'step-1',
            toolCallId: 'call-1',
        };
        const record = {
            executionId: createToolExecutionId(identity),
            identity,
            input: { path: 'src/app.ts' },
            toolName: 'write_file',
            status: 'running' as const,
            startedAt,
            updatedAt: startedAt,
        };

        await store.start({ record });
        await store.complete({
            executionId: record.executionId,
            completedAt,
            result: { result: 'created file' },
        });

        await expect(
            store.fail({
                executionId: record.executionId,
                completedAt: new Date('2026-05-11T00:00:02.000Z'),
                error: 'late failure',
            })
        ).rejects.toThrow('Tool execution is already completed');
        await expect(store.get({ executionId: record.executionId })).resolves.toEqual(
            expect.objectContaining({
                status: 'completed',
                modelOutput: 'created file',
            })
        );
    });
});
