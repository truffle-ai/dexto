import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DextoAgent } from './DextoAgent.js';
import type { AgentRuntimeSettings } from './runtime-config.js';
import { SystemPromptConfigSchema } from '../systemPrompt/schemas.js';
import { LLMConfigSchema } from '../llm/schemas.js';
import { LoggerConfigSchema } from '../logger/index.js';
import { SessionConfigSchema } from '../session/schemas.js';
import { PermissionsConfigSchema, ElicitationConfigSchema } from '../tools/schemas.js';
import { ResourcesConfigSchema } from '../resources/schemas.js';
import { PromptsSchema } from '../prompts/schemas.js';
import { createLogger } from '../logger/factory.js';
import { ServersConfigSchema } from '../mcp/schemas.js';
import {
    createInMemoryBlobStore,
    createInMemoryCache,
    createInMemoryDatabase,
} from '../test-utils/in-memory-storage.js';
import type { CompactionStrategy } from '../context/compaction/types.js';
import { filterCompacted } from '../context/utils.js';
import type { InternalMessage } from '../context/types.js';

const testCompactionStrategy: CompactionStrategy = {
    name: 'test-session-compaction',
    getSettings: () => ({
        enabled: true,
        thresholdPercent: 0.9,
    }),
    getModelLimits: (modelContextWindow: number) => ({
        contextWindow: modelContextWindow,
    }),
    shouldCompact: () => false,
    compact: async () => [
        {
            role: 'assistant',
            content: [{ type: 'text', text: 'Compacted summary' }],
            timestamp: Date.now(),
            metadata: {
                isSummary: true,
                originalMessageCount: 2,
            },
        },
    ],
};

const testSettings: AgentRuntimeSettings = {
    systemPrompt: SystemPromptConfigSchema.parse('You are a helpful assistant.'),
    llm: LLMConfigSchema.parse({
        provider: 'openai',
        model: 'gpt-5-mini',
        apiKey: 'test-key-123',
    }),
    agentId: 'session-compaction-test-agent',
    mcpServers: ServersConfigSchema.parse({}),
    sessions: SessionConfigSchema.parse({
        maxSessions: 10,
        sessionTTL: 1000,
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

async function addSeedHistory(agent: DextoAgent, sessionId: string): Promise<void> {
    const session = await agent.createSession(sessionId);
    const contextManager = session.getContextManager();

    const messages: InternalMessage[] = [
        {
            role: 'user',
            content: [{ type: 'text', text: 'old request' }],
        },
        {
            role: 'assistant',
            content: [{ type: 'text', text: 'old response' }],
        },
        {
            role: 'user',
            content: [{ type: 'text', text: 'keep this request' }],
        },
        {
            role: 'assistant',
            content: [{ type: 'text', text: 'keep this response' }],
        },
    ];

    for (const message of messages) {
        await contextManager.addMessage(message);
    }
}

async function addShortSeedHistory(agent: DextoAgent, sessionId: string): Promise<void> {
    const session = await agent.createSession(sessionId);
    const contextManager = session.getContextManager();

    await contextManager.addMessage({
        role: 'user',
        content: [{ type: 'text', text: 'brief request' }],
    });
    await contextManager.addMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'brief response' }],
    });
}

describe('DextoAgent session compaction integration', () => {
    let agent: DextoAgent;

    beforeEach(async () => {
        const loggerConfig = LoggerConfigSchema.parse({
            level: 'warn',
            transports: [{ type: 'console', colorize: false }],
        });
        const logger = createLogger({ config: loggerConfig, agentId: testSettings.agentId });

        agent = new DextoAgent({
            ...testSettings,
            logger,
            storage: {
                blob: createInMemoryBlobStore(),
                database: createInMemoryDatabase(),
                cache: createInMemoryCache(),
            },
            compaction: testCompactionStrategy,
            tools: [],
            hooks: [],
        });
        await agent.start();
    });

    afterEach(async () => {
        if (agent.isStarted()) {
            await agent.stop();
        }
    });

    it('continues in place and persists a compaction artifact', async () => {
        const sessionId = 'compact-in-place';
        await addSeedHistory(agent, sessionId);

        const compaction = await agent.compactSession({
            sessionId,
            mode: 'continue-in-place',
            trigger: 'manual',
        });

        expect(compaction).not.toBeNull();
        expect(compaction?.targetSessionId).toBeUndefined();
        expect(compaction?.mode).toBe('continue-in-place');
        expect(compaction?.summaryMessages).toHaveLength(1);
        expect(compaction?.continuationMessages).toHaveLength(3);

        const stored = await agent.getSessionCompaction(compaction!.id);
        expect(stored?.id).toBe(compaction?.id);

        const history = await agent.getSessionHistory(sessionId);
        expect(history).toHaveLength(5);

        const filtered = filterCompacted(history);
        expect(filtered).toHaveLength(3);
        expect(filtered[0]?.metadata?.isSummary).toBe(true);
    });

    it('creates a seeded child session from the persisted continuation artifact', async () => {
        const sessionId = 'compact-in-child';
        await addSeedHistory(agent, sessionId);

        const compaction = await agent.compactSession({
            sessionId,
            mode: 'continue-in-child',
            trigger: 'api',
        });

        expect(compaction).not.toBeNull();
        expect(compaction?.targetSessionId).toBeDefined();
        expect(compaction?.mode).toBe('continue-in-child');

        const sourceHistory = await agent.getSessionHistory(sessionId);
        expect(sourceHistory).toHaveLength(4);

        const childSessionId = compaction!.targetSessionId!;
        const childHistory = await agent.getSessionHistory(childSessionId);
        expect(childHistory).toHaveLength(compaction!.continuationMessages.length);
        expect(childHistory[0]?.metadata?.isSummary).toBe(true);

        const childMetadata = await agent.getSessionMetadata(childSessionId);
        expect(childMetadata?.parentSessionId).toBe(sessionId);
        expect(childMetadata?.messageCount).toBe(compaction?.continuationMessages.length);

        const stored = await agent.getSessionCompaction(compaction!.id);
        expect(stored?.targetSessionId).toBe(childSessionId);
    });

    it('persists an artifact without mutating the source session when using artifact-only mode', async () => {
        const sessionId = 'compact-artifact-only';
        await addSeedHistory(agent, sessionId);

        const compaction = await agent.compactSession({
            sessionId,
            mode: 'artifact-only',
            trigger: 'scheduled',
        });

        expect(compaction).not.toBeNull();
        expect(compaction?.mode).toBe('artifact-only');
        expect(compaction?.trigger).toBe('scheduled');
        expect(compaction?.targetSessionId).toBeUndefined();

        const history = await agent.getSessionHistory(sessionId);
        expect(history).toHaveLength(4);
        expect(filterCompacted(history)).toHaveLength(4);

        const stored = await agent.getSessionCompaction(compaction!.id);
        expect(stored?.id).toBe(compaction?.id);
        expect(stored?.mode).toBe('artifact-only');
        expect(stored?.continuationMessages).toHaveLength(3);
    });

    it('allows session compaction for short histories when the strategy returns a summary', async () => {
        const sessionId = 'compact-short-history';
        await addShortSeedHistory(agent, sessionId);

        const compaction = await agent.compactSession({
            sessionId,
            mode: 'continue-in-place',
            trigger: 'manual',
        });

        expect(compaction).not.toBeNull();
        expect(compaction?.summaryMessages).toHaveLength(1);
        expect(compaction?.continuationMessages).toHaveLength(1);
    });

    it('validates the input object before reading sessionId', async () => {
        await expect(Reflect.apply(agent.compactSession, agent, [undefined])).rejects.toThrow(
            'input is required and must be an object'
        );
    });

    it('rejects childTitle outside continue-in-child mode for direct SDK consumers', async () => {
        const sessionId = 'compact-child-title-invalid';
        await addSeedHistory(agent, sessionId);

        await expect(
            agent.compactSession({
                sessionId,
                mode: 'artifact-only',
                childTitle: 'Should not be allowed',
            })
        ).rejects.toThrow('childTitle is only supported when mode is "continue-in-child"');
    });

    it('does not mutate the source session when artifact persistence fails in continue-in-place mode', async () => {
        const sessionId = 'compact-in-place-save-failure';
        await addSeedHistory(agent, sessionId);

        const saveSpy = vi
            .spyOn(agent.sessionManager, 'saveSessionCompaction')
            .mockRejectedValueOnce(new Error('persist failed'));

        await expect(
            agent.compactSession({
                sessionId,
                mode: 'continue-in-place',
                trigger: 'manual',
            })
        ).rejects.toThrow('persist failed');

        const history = await agent.getSessionHistory(sessionId);
        expect(history).toHaveLength(4);
        expect(filterCompacted(history)).toHaveLength(4);

        saveSpy.mockRestore();
    });

    it('rolls back the child session when artifact persistence fails in continue-in-child mode', async () => {
        const sessionId = 'compact-in-child-save-failure';
        await addSeedHistory(agent, sessionId);

        const originalCreateSeededChildSession = agent.sessionManager.createSeededChildSession.bind(
            agent.sessionManager
        );
        let childSessionId: string | undefined;

        const createSpy = vi
            .spyOn(agent.sessionManager, 'createSeededChildSession')
            .mockImplementation(async (parentSessionId, options) => {
                const childSession = await originalCreateSeededChildSession(
                    parentSessionId,
                    options
                );
                childSessionId = childSession.id;
                return childSession;
            });
        const saveSpy = vi
            .spyOn(agent.sessionManager, 'saveSessionCompaction')
            .mockRejectedValueOnce(new Error('persist failed'));

        await expect(
            agent.compactSession({
                sessionId,
                mode: 'continue-in-child',
                trigger: 'api',
            })
        ).rejects.toThrow('persist failed');

        if (!childSessionId) {
            throw new Error('Expected child session to be created before persistence failure');
        }

        const sourceHistory = await agent.getSessionHistory(sessionId);
        expect(sourceHistory).toHaveLength(4);
        expect(await agent.getSessionMetadata(childSessionId)).toBeUndefined();

        saveSpy.mockRestore();
        createSpy.mockRestore();
    });

    it('rejects strategies that return multiple summary messages for session compaction', async () => {
        const sessionId = 'compact-multi-summary-invalid';
        await addSeedHistory(agent, sessionId);

        const session = await agent.getSession(sessionId);
        if (!session) {
            throw new Error(`Expected session '${sessionId}' to exist`);
        }

        const multiSummaryStrategy: CompactionStrategy = {
            ...testCompactionStrategy,
            compact: async () => [
                {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Summary one' }],
                    metadata: {
                        isSummary: true,
                        originalMessageCount: 2,
                    },
                },
                {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Summary two' }],
                    metadata: {
                        isSummary: true,
                        originalMessageCount: 2,
                    },
                },
            ],
        };

        const getCompactionStrategySpy = vi
            .spyOn(session.getLLMService(), 'getCompactionStrategy')
            .mockReturnValue(multiSummaryStrategy);

        await expect(
            agent.compactSession({
                sessionId,
                mode: 'continue-in-place',
                trigger: 'manual',
            })
        ).rejects.toThrow('must return exactly one summary message');

        const history = await agent.getSessionHistory(sessionId);
        expect(history).toHaveLength(4);
        expect(history.some((message) => message.metadata?.isSummary === true)).toBe(false);

        getCompactionStrategySpy.mockRestore();
    });
});
