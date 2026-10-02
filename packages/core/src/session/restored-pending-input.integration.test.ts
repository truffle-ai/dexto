import { describe, test, expect, afterEach } from 'vitest';
import { simulateReadableStream } from 'ai';
import type {
    LanguageModelV2,
    LanguageModelV2CallOptions,
    LanguageModelV2StreamPart,
} from '@ai-sdk/provider';
import { DextoAgent } from '../agent/DextoAgent.js';
import type { AgentRuntimeSettings } from '../agent/runtime-config.js';
import { SystemPromptConfigSchema } from '../systemPrompt/schemas.js';
import { LLMConfigSchema } from '../llm/schemas.js';
import { LoggerConfigSchema } from '../logger/index.js';
import { SessionConfigSchema } from './schemas.js';
import { SessionErrorCode } from './error-codes.js';
import { PermissionsConfigSchema, ElicitationConfigSchema } from '../tools/schemas.js';
import { ResourcesConfigSchema } from '../resources/schemas.js';
import { PromptsSchema } from '../prompts/schemas.js';
import { createLogger } from '../logger/factory.js';
import { ServersConfigSchema } from '../mcp/schemas.js';
import { DatabaseConversationStore } from '../storage/conversation/database.js';
import {
    BackendDextoStores,
    DatabaseBackedApprovalStore,
    DatabaseBackedArtifactStore,
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
} from '../storage/index.js';
import {
    createInMemoryBlobStore,
    createInMemoryCache,
    createInMemoryDatabase,
} from '../test-utils/in-memory-storage.js';
import type { ContentPart } from '../context/types.js';

/**
 * Regression coverage for issue #743.
 *
 * A queued instruction from an interrupted run must never be silently attached to the next
 * unrelated user message after the session is reopened. Reopening reveals the pending input,
 * and only an explicit resume or discard decision consumes it.
 */

type SharedStorage = {
    blob: ReturnType<typeof createInMemoryBlobStore>;
    cache: ReturnType<typeof createInMemoryCache>;
    database: ReturnType<typeof createInMemoryDatabase>;
};

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function promptText(prompt: LanguageModelV2CallOptions['prompt']): string {
    return prompt
        .map((message) => {
            if (typeof message.content === 'string') {
                return message.content;
            }
            return message.content
                .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
                .join('\n');
        })
        .join('\n');
}

/**
 * A scripted model that records every prompt it receives and can be paused behind a gate so a
 * turn stays "busy" for as long as the test needs.
 */
class ScriptedModel {
    readonly model: LanguageModelV2;
    readonly prompts: string[] = [];
    private gate: ReturnType<typeof createDeferred<void>> | null = null;
    private firstCall = createDeferred<void>();

    constructor(private readonly replyText: string) {
        this.model = {
            specificationVersion: 'v2',
            provider: 'openai',
            modelId: 'gpt-5-mini',
            supportedUrls: {},
            doGenerate: async () => {
                throw new Error('ScriptedModel only supports streaming');
            },
            doStream: async (options) => {
                this.prompts.push(promptText(options.prompt));
                this.firstCall.resolve();
                if (this.gate) {
                    await this.gate.promise;
                }
                const chunks: LanguageModelV2StreamPart[] = [
                    { type: 'stream-start', warnings: [] },
                    { type: 'text-start', id: 'text-1' },
                    { type: 'text-delta', id: 'text-1', delta: this.replyText },
                    { type: 'text-end', id: 'text-1' },
                    {
                        type: 'finish',
                        finishReason: 'stop',
                        usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
                    },
                ];
                return { stream: simulateReadableStream({ chunks }) };
            },
        };
    }

    /** Hold every model call until release() is called. */
    hold(): void {
        this.gate = createDeferred<void>();
    }

    release(): void {
        this.gate?.resolve();
        this.gate = null;
    }

    /** Resolves once the model has been called at least once. */
    waitForFirstCall(): Promise<void> {
        return this.firstCall.promise;
    }

    resetPrompts(): void {
        this.prompts.length = 0;
    }
}

describe('Session Integration: Restored pending input after an interrupted run', () => {
    let agents: DextoAgent[] = [];
    let originalOpenAiApiKey: string | undefined;

    const baseSettings: AgentRuntimeSettings = {
        systemPrompt: SystemPromptConfigSchema.parse('You are a helpful assistant.'),
        llm: LLMConfigSchema.parse({
            provider: 'openai',
            model: 'gpt-5-mini',
            apiKey: 'test-key-123',
        }),
        agentId: 'restored-pending-input-test-agent',
        mcpServers: ServersConfigSchema.parse({}),
        sessions: SessionConfigSchema.parse({
            maxSessions: 10,
            sessionTTL: 60000,
        }),
        permissions: PermissionsConfigSchema.parse({
            mode: 'auto-approve',
            timeout: 120000,
        }),
        elicitation: ElicitationConfigSchema.parse({
            enabled: false,
            timeout: 120000,
        }),
        resources: ResourcesConfigSchema.parse([]),
        prompts: PromptsSchema.parse([]),
    };

    function createSharedStorage(): SharedStorage {
        return {
            blob: createInMemoryBlobStore(),
            cache: createInMemoryCache(),
            database: createInMemoryDatabase(),
        };
    }

    async function createAgent(
        agentId: string,
        storage: SharedStorage,
        model: ScriptedModel
    ): Promise<DextoAgent> {
        const loggerConfig = LoggerConfigSchema.parse({
            level: 'warn',
            transports: [{ type: 'console', colorize: false }],
        });
        const logger = createLogger({ config: loggerConfig, agentId });

        const agent = new DextoAgent({
            ...baseSettings,
            agentId,
            logger,
            stores: new BackendDextoStores(
                {
                    conversation: new DatabaseConversationStore(storage.database, logger),
                    sessions: new DatabaseBackedSessionStore(storage.database, storage.cache),
                    memories: new DatabaseBackedMemoryStore(storage.database),
                    workspaces: new DatabaseBackedWorkspaceStore(storage.database),
                    approvals: new DatabaseBackedApprovalStore(
                        storage.database,
                        storage.cache,
                        logger
                    ),
                    toolPreferences: new DatabaseBackedToolPreferenceStore(
                        storage.database,
                        storage.cache,
                        logger
                    ),
                    toolState: new DatabaseBackedToolStateStore(storage.database),
                    steerQueue: new DatabaseBackedSessionMessageQueueStore(
                        storage.database,
                        logger,
                        SESSION_STEER_QUEUE_KEY_PREFIX
                    ),
                    followUpQueue: new DatabaseBackedSessionMessageQueueStore(
                        storage.database,
                        logger,
                        SESSION_FOLLOW_UP_QUEUE_KEY_PREFIX
                    ),
                    customPrompts: new DatabaseBackedCustomPromptStore(storage.database),
                    artifacts: new DatabaseBackedArtifactStore(storage.blob),
                    runtimeEvents: new DatabaseBackedRuntimeEventStore(storage.database),
                    toolExecutions: new DatabaseBackedToolExecutionStore(storage.database),
                },
                {
                    async connect(): Promise<void> {
                        await storage.cache.connect();
                        await storage.database.connect();
                        await storage.blob.connect();
                    },
                    async disconnect(): Promise<void> {
                        await Promise.all([
                            storage.cache.disconnect(),
                            storage.database.disconnect(),
                            storage.blob.disconnect(),
                        ]);
                    },
                    isConnected(): boolean {
                        return (
                            storage.cache.isConnected() &&
                            storage.database.isConnected() &&
                            storage.blob.isConnected()
                        );
                    },
                }
            ),
            tools: [],
            hooks: [],
            overrides: {
                languageModelFactory: async () => model.model,
            },
        });
        await agent.start();
        agents.push(agent);
        return agent;
    }

    const sessionId = 'interrupted-run-session';
    const steerKey = `${SESSION_STEER_QUEUE_KEY_PREFIX}:${sessionId}`;
    const followUpKey = `${SESSION_FOLLOW_UP_QUEUE_KEY_PREFIX}:${sessionId}`;
    const STEER_TEXT = 'INTERRUPTED-STEER now about de gea';
    const FOLLOW_UP_TEXT = 'INTERRUPTED-FOLLOW-UP then summarize the season';
    const UNRELATED_TEXT = 'UNRELATED poopie';

    async function userTextsInHistory(agent: DextoAgent): Promise<string[]> {
        const history = await agent.getSessionHistory(sessionId);
        return history
            .filter((message) => message.role === 'user')
            .map((message) =>
                message.content
                    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
                    .map((part) => part.text)
                    .join('\n')
            );
    }

    /**
     * Start a run that stays busy behind the model gate, queue one steer and one follow-up while
     * it is busy, then interrupt it. Returns the storage so a second agent can restart from it,
     * and the first run's promise: callers release the model after their restart assertions and
     * await the run, so it settles before teardown disconnects the shared stores.
     */
    async function interruptRunWithQueuedInput(options: { graceful: boolean }): Promise<{
        storage: SharedStorage;
        model: ScriptedModel;
        agent: DextoAgent;
        run: Promise<unknown>;
    }> {
        const storage = createSharedStorage();
        const model = new ScriptedModel('first run reply');
        const agent = await createAgent('interrupted-agent', storage, model);
        await agent.createSession(sessionId);

        model.hold();
        const run = agent.generate('start a long task', sessionId);
        await model.waitForFirstCall();

        await agent.steer(sessionId, { content: [{ type: 'text', text: STEER_TEXT }] });
        await agent.followUp(sessionId, { content: [{ type: 'text', text: FOLLOW_UP_TEXT }] });

        expect(await storage.database.getRange(steerKey, 0, 10)).toHaveLength(1);
        expect(await storage.database.getRange(followUpKey, 0, 10)).toHaveLength(1);

        if (options.graceful) {
            // Ctrl+C once cancels the run, Ctrl+C again shuts the process down cleanly. The
            // session layer is shut down the way agent.stop() does it; the in-memory test
            // database wipes itself on disconnect, so the storage disconnect step is skipped.
            await agent.cancel(sessionId);
            model.release();
            // The cancelled run settles by rejecting; anything else is a real failure.
            await expect(run).rejects.toThrow('Stream did not complete successfully');
            await agent.sessionManager.cleanup();
            expect(await storage.database.getRange(steerKey, 0, 10)).toHaveLength(1);
            expect(await storage.database.getRange(followUpKey, 0, 10)).toHaveLength(1);
        }
        // Abrupt: the process dies mid-run. Nothing is cancelled or cleaned up; the run stays
        // parked behind the gate and the persisted rows are all the next process sees.

        // Graceful: the run already settled above. Abrupt: it is still parked behind the gate.
        return { storage, model, agent, run: options.graceful ? Promise.resolve() : run };
    }

    afterEach(async () => {
        for (const agent of [...agents].reverse()) {
            if (agent.isStarted()) {
                await agent.stop();
            }
        }
        agents = [];
        if (originalOpenAiApiKey === undefined) {
            delete process.env.OPENAI_API_KEY;
        } else {
            process.env.OPENAI_API_KEY = originalOpenAiApiKey;
        }
    });

    function stashApiKey(): void {
        originalOpenAiApiKey = process.env.OPENAI_API_KEY;
        process.env.OPENAI_API_KEY = 'test-key-123';
    }

    test.each([
        { label: 'graceful interruption (cancel + stop)', graceful: true },
        { label: 'abrupt interruption (process death mid-run)', graceful: false },
    ])(
        'after $label, an unrelated new message on the reopened session does not execute the restored queue',
        async ({ graceful }) => {
            stashApiKey();
            const {
                storage,
                model: firstModel,
                run: firstRun,
            } = await interruptRunWithQueuedInput({ graceful });

            try {
                const restartedModel = new ScriptedModel('second run reply');
                const restarted = await createAgent('restarted-agent', storage, restartedModel);

                expect(await restarted.getSession(sessionId)).toBeDefined();

                restartedModel.resetPrompts();
                const response = await restarted.generate(UNRELATED_TEXT, sessionId);
                expect(response.content).toBe('second run reply');

                // Exactly one model call, carrying only the unrelated message.
                expect(restartedModel.prompts).toHaveLength(1);
                expect(restartedModel.prompts[0]).toContain(UNRELATED_TEXT);
                for (const prompt of restartedModel.prompts) {
                    expect(prompt).not.toContain(STEER_TEXT);
                    expect(prompt).not.toContain(FOLLOW_UP_TEXT);
                }

                // The restored entries were not injected into the conversation either.
                const userTexts = await userTextsInHistory(restarted);
                expect(userTexts.filter((text) => text.includes(STEER_TEXT))).toHaveLength(0);
                expect(userTexts.filter((text) => text.includes(FOLLOW_UP_TEXT))).toHaveLength(0);

                // They are still pending an explicit decision, durably.
                expect(await storage.database.getRange(steerKey, 0, 10)).toHaveLength(1);
                expect(await storage.database.getRange(followUpKey, 0, 10)).toHaveLength(1);
                const pending = await restarted.getRestoredPendingInput(sessionId);
                expect(pending.steer.map((message) => message.content)).toEqual([
                    [{ type: 'text', text: STEER_TEXT }],
                ]);
                expect(pending.followUp.map((message) => message.content)).toEqual([
                    [{ type: 'text', text: FOLLOW_UP_TEXT }],
                ]);
            } finally {
                firstModel.release();
                await firstRun;
            }
        }
    );

    test('reopening reveals restored pending input; resuming takes it exactly once and runs it as the next turn', async () => {
        stashApiKey();
        const {
            storage,
            model: firstModel,
            run: firstRun,
        } = await interruptRunWithQueuedInput({
            graceful: false,
        });

        try {
            const restartedModel = new ScriptedModel('resumed reply');
            const restarted = await createAgent('resume-agent', storage, restartedModel);
            expect(await restarted.getSession(sessionId)).toBeDefined();

            // Reopen reveals the pending work without executing it.
            const pending = await restarted.getRestoredPendingInput(sessionId);
            expect(pending.steer).toHaveLength(1);
            expect(pending.followUp).toHaveLength(1);
            expect(restartedModel.prompts).toHaveLength(0);

            // Live queue views still list the same entries (nothing was dropped or hidden).
            expect(await restarted.getSteerMessages(sessionId)).toEqual(pending.steer);
            expect(await restarted.getFollowUpMessages(sessionId)).toEqual(pending.followUp);

            // Concurrent double resume: exactly one caller receives the entries.
            const [first, second] = await Promise.all([
                restarted.takeRestoredPendingInput(sessionId),
                restarted.takeRestoredPendingInput(sessionId),
            ]);
            const taken = first ?? second;
            expect(taken).not.toBeNull();
            expect(first === null || second === null).toBe(true);
            expect(taken?.messages.map((message) => message.id)).toEqual([
                pending.steer[0]?.id,
                pending.followUp[0]?.id,
            ]);

            // A repeated resume is a no-op: the entries left durable storage with the first take.
            expect(await restarted.takeRestoredPendingInput(sessionId)).toBeNull();
            expect(await storage.database.getRange(steerKey, 0, 10)).toHaveLength(0);
            expect(await storage.database.getRange(followUpKey, 0, 10)).toHaveLength(0);
            expect(await restarted.getRestoredPendingInput(sessionId)).toEqual({
                steer: [],
                followUp: [],
            });

            // The host runs the taken content as an ordinary turn.
            const combined: ContentPart[] = taken?.combinedContent ?? [];
            const response = await restarted.generate(combined, sessionId);
            expect(response.content).toBe('resumed reply');
            expect(restartedModel.prompts).toHaveLength(1);
            expect(restartedModel.prompts[0]).toContain(STEER_TEXT);
            expect(restartedModel.prompts[0]).toContain(FOLLOW_UP_TEXT);
        } finally {
            firstModel.release();
            await firstRun;
        }
    });

    test('resume is refused while a run is active so entries cannot leave the queue unrun', async () => {
        stashApiKey();
        const {
            storage,
            model: firstModel,
            run: firstRun,
        } = await interruptRunWithQueuedInput({
            graceful: false,
        });

        try {
            const restartedModel = new ScriptedModel('busy reply');
            const restarted = await createAgent('busy-agent', storage, restartedModel);
            expect(await restarted.getSession(sessionId)).toBeDefined();

            restartedModel.hold();
            const run = restarted.generate(UNRELATED_TEXT, sessionId);
            await restartedModel.waitForFirstCall();

            await expect(restarted.takeRestoredPendingInput(sessionId)).rejects.toMatchObject({
                code: SessionErrorCode.SESSION_BUSY,
            });
            expect(await storage.database.getRange(steerKey, 0, 10)).toHaveLength(1);
            expect(await storage.database.getRange(followUpKey, 0, 10)).toHaveLength(1);

            restartedModel.release();
            await run;
            expect(restartedModel.prompts).toHaveLength(1);

            const taken = await restarted.takeRestoredPendingInput(sessionId);
            expect(taken?.messages).toHaveLength(2);
        } finally {
            firstModel.release();
            await firstRun;
        }
    });

    /** Intercept the next `updateList` call on `key` (the queue stores' only write path). */
    function interceptNextUpdate(
        storage: SharedStorage,
        key: string,
        interceptor: () => Promise<void>
    ): void {
        const database = storage.database;
        const original = database.updateList.bind(database);
        let armed = true;
        database.updateList = (async (listKey: string, updater: never) => {
            if (armed && listKey === key) {
                armed = false;
                await interceptor();
            }
            return original(listKey, updater);
        }) as typeof database.updateList;
    }

    test('a storage failure while taking restored input leaves every restored entry in place', async () => {
        stashApiKey();
        const {
            storage,
            model: firstModel,
            run: firstRun,
        } = await interruptRunWithQueuedInput({ graceful: false });

        try {
            const restartedModel = new ScriptedModel('resumed reply');
            const restarted = await createAgent('failing-take-agent', storage, restartedModel);
            expect(await restarted.getSession(sessionId)).toBeDefined();

            // The steer take succeeds, then the follow-up take fails.
            interceptNextUpdate(storage, followUpKey, async () => {
                throw new Error('follow-up queue storage unavailable');
            });
            await expect(restarted.takeRestoredPendingInput(sessionId)).rejects.toThrow(
                'follow-up queue storage unavailable'
            );

            expect(await storage.database.getRange(steerKey, 0, 10)).toHaveLength(1);
            expect(await storage.database.getRange(followUpKey, 0, 10)).toHaveLength(1);
            const pending = await restarted.getRestoredPendingInput(sessionId);
            expect(pending.steer).toHaveLength(1);
            expect(pending.followUp).toHaveLength(1);

            // Still held: an unrelated turn does not pick them up, and a retry takes both.
            const response = await restarted.generate(UNRELATED_TEXT, sessionId);
            expect(response.content).toBe('resumed reply');
            expect(restartedModel.prompts).toHaveLength(1);
            expect(restartedModel.prompts[0]).not.toContain(STEER_TEXT);
            const taken = await restarted.takeRestoredPendingInput(sessionId);
            expect(taken?.messages).toHaveLength(2);
        } finally {
            firstModel.release();
            await firstRun;
        }
    });

    test('a turn that starts while restored input is being taken leaves the input in place', async () => {
        stashApiKey();
        const {
            storage,
            model: firstModel,
            run: firstRun,
        } = await interruptRunWithQueuedInput({ graceful: false });

        try {
            const restartedModel = new ScriptedModel('racing reply');
            const restarted = await createAgent('racing-agent', storage, restartedModel);
            expect(await restarted.getSession(sessionId)).toBeDefined();

            // Pause queue storage inside the resume, and start a turn during the pause.
            const storagePaused = createDeferred<void>();
            const resumeStorage = createDeferred<void>();
            interceptNextUpdate(storage, steerKey, async () => {
                storagePaused.resolve();
                await resumeStorage.promise;
            });
            const take = restarted.takeRestoredPendingInput(sessionId);
            await storagePaused.promise;

            restartedModel.hold();
            const run = restarted.generate(UNRELATED_TEXT, sessionId);
            await restartedModel.waitForFirstCall();
            resumeStorage.resolve();

            await expect(take).rejects.toMatchObject({ code: SessionErrorCode.SESSION_BUSY });
            expect(await storage.database.getRange(steerKey, 0, 10)).toHaveLength(1);
            expect(await storage.database.getRange(followUpKey, 0, 10)).toHaveLength(1);

            restartedModel.release();
            await run;
            expect(restartedModel.prompts).toHaveLength(1);
            expect(restartedModel.prompts[0]).not.toContain(STEER_TEXT);
            expect(restartedModel.prompts[0]).not.toContain(FOLLOW_UP_TEXT);

            const taken = await restarted.takeRestoredPendingInput(sessionId);
            expect(taken?.messages).toHaveLength(2);
        } finally {
            firstModel.release();
            await firstRun;
        }
    });

    test('when putting one queue back fails, the other is still restored and the busy error is kept', async () => {
        stashApiKey();
        const {
            storage,
            model: firstModel,
            run: firstRun,
        } = await interruptRunWithQueuedInput({ graceful: false });

        try {
            const restartedModel = new ScriptedModel('racing reply');
            const restarted = await createAgent('failing-restore-agent', storage, restartedModel);
            expect(await restarted.getSession(sessionId)).toBeDefined();

            const storagePaused = createDeferred<void>();
            const resumeStorage = createDeferred<void>();
            interceptNextUpdate(storage, steerKey, async () => {
                storagePaused.resolve();
                await resumeStorage.promise;
            });
            const take = restarted.takeRestoredPendingInput(sessionId);
            await storagePaused.promise;
            // The steer take is paused; its rollback write will be the next steer update.
            interceptNextUpdate(storage, steerKey, async () => {
                throw new Error('steer queue storage unavailable');
            });

            restartedModel.hold();
            const run = restarted.generate(UNRELATED_TEXT, sessionId);
            await restartedModel.waitForFirstCall();
            resumeStorage.resolve();

            await expect(take).rejects.toMatchObject({ code: SessionErrorCode.SESSION_BUSY });
            expect(await storage.database.getRange(followUpKey, 0, 10)).toHaveLength(1);
            expect((await restarted.getRestoredPendingInput(sessionId)).followUp).toHaveLength(1);

            restartedModel.release();
            await run;
            expect(restartedModel.prompts[0]).not.toContain(FOLLOW_UP_TEXT);
        } finally {
            firstModel.release();
            await firstRun;
        }
    });

    test('discarding restored pending input is durable across another restart', async () => {
        stashApiKey();
        const {
            storage,
            model: firstModel,
            run: firstRun,
        } = await interruptRunWithQueuedInput({
            graceful: true,
        });

        try {
            const discardModel = new ScriptedModel('unused');
            const discarding = await createAgent('discard-agent', storage, discardModel);
            expect(await discarding.getSession(sessionId)).toBeDefined();

            expect(await discarding.discardRestoredPendingInput(sessionId)).toBe(2);
            expect(await discarding.discardRestoredPendingInput(sessionId)).toBe(0);
            expect(await storage.database.getRange(steerKey, 0, 10)).toHaveLength(0);
            expect(await storage.database.getRange(followUpKey, 0, 10)).toHaveLength(0);
            expect(await discarding.getSteerMessages(sessionId)).toEqual([]);
            expect(await discarding.getFollowUpMessages(sessionId)).toEqual([]);
            await discarding.sessionManager.cleanup();

            const laterModel = new ScriptedModel('later reply');
            const later = await createAgent('later-agent', storage, laterModel);
            expect(await later.getSession(sessionId)).toBeDefined();
            expect(await later.getRestoredPendingInput(sessionId)).toEqual({
                steer: [],
                followUp: [],
            });

            const response = await later.generate(UNRELATED_TEXT, sessionId);
            expect(response.content).toBe('later reply');
            expect(laterModel.prompts).toHaveLength(1);
            expect(laterModel.prompts[0]).not.toContain(STEER_TEXT);
            expect(laterModel.prompts[0]).not.toContain(FOLLOW_UP_TEXT);
        } finally {
            firstModel.release();
            await firstRun;
        }
    });

    test('input queued by the live process keeps draining inside the turn (in-process behaviour unchanged)', async () => {
        stashApiKey();
        const storage = createSharedStorage();
        const model = new ScriptedModel('live reply');
        const agent = await createAgent('live-agent', storage, model);
        await agent.createSession(sessionId);

        model.hold();
        const run = agent.generate('start a long task', sessionId);
        await model.waitForFirstCall();
        await agent.followUp(sessionId, { content: [{ type: 'text', text: FOLLOW_UP_TEXT }] });
        model.release();
        await run;

        // First call carried the task, the follow-up ran as a continuation of the same turn.
        expect(model.prompts).toHaveLength(2);
        expect(model.prompts[1]).toContain(FOLLOW_UP_TEXT);
        expect(await storage.database.getRange(followUpKey, 0, 10)).toHaveLength(0);
        expect(await agent.getRestoredPendingInput(sessionId)).toEqual({
            steer: [],
            followUp: [],
        });
    });
});
