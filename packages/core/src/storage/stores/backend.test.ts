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
    DatabaseBackedToolPreferenceStore,
    DatabaseBackedToolStateStore,
    DatabaseBackedWorkspaceStore,
    SESSION_FOLLOW_UP_QUEUE_KEY_PREFIX,
    SESSION_STEER_QUEUE_KEY_PREFIX,
} from './backend.js';

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
                    cache,
                    logger,
                    SESSION_STEER_QUEUE_KEY_PREFIX
                ),
                followUpQueue: new DatabaseBackedSessionMessageQueueStore(
                    database,
                    cache,
                    logger,
                    SESSION_FOLLOW_UP_QUEUE_KEY_PREFIX
                ),
                customPrompts: new DatabaseBackedCustomPromptStore(database),
                artifacts: new DatabaseBackedArtifactStore(blobStore),
                runtimeEvents: new DatabaseBackedRuntimeEventStore(database),
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
        await stores.getStore('steerQueue').save({
            sessionId: 'session-1',
            queue: [
                {
                    id: 'queued-1',
                    content: [{ type: 'text', text: 'next' }],
                    queuedAt: 2,
                },
            ],
        });
        await stores.getStore('followUpQueue').save({
            sessionId: 'session-1',
            queue: [
                {
                    id: 'follow-up-1',
                    content: [{ type: 'text', text: 'later' }],
                    queuedAt: 3,
                },
            ],
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
        expect(await stores.getStore('steerQueue').load({ sessionId: 'session-1' })).toEqual([
            {
                id: 'queued-1',
                content: [{ type: 'text', text: 'next' }],
                queuedAt: 2,
            },
        ]);
        expect(await stores.getStore('followUpQueue').load({ sessionId: 'session-1' })).toEqual([
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
