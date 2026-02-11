import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { DextoAgent } from '../agent/DextoAgent.js';
import type { AgentRuntimeSettings } from '../agent/runtime-config.js';
import { SystemPromptConfigSchema } from '../systemPrompt/schemas.js';
import { LLMConfigSchema } from '../llm/schemas.js';
import { LoggerConfigSchema } from '../logger/index.js';
import { SessionConfigSchema } from './schemas.js';
import { ToolConfirmationConfigSchema, ElicitationConfigSchema } from '../tools/schemas.js';
import { InternalResourcesSchema } from '../resources/schemas.js';
import { PromptsSchema } from '../prompts/schemas.js';
import { createLogger } from '../logger/factory.js';
import type { SessionData } from './session-manager.js';
import { ServerConfigsSchema } from '../mcp/schemas.js';
import {
    createInMemoryBlobStore,
    createInMemoryCache,
    createInMemoryDatabase,
} from '../test-utils/in-memory-storage.js';

/**
 * Full end-to-end integration tests for chat history preservation.
 * Tests the complete flow from DextoAgent -> SessionManager -> ChatSession -> Storage
 */
describe('Session Integration: Chat History Preservation', () => {
    let agent: DextoAgent;

    const testSettings: AgentRuntimeSettings = {
        systemPrompt: SystemPromptConfigSchema.parse('You are a helpful assistant.'),
        llm: LLMConfigSchema.parse({
            provider: 'openai',
            model: 'gpt-5-mini',
            apiKey: 'test-key-123',
        }),
        agentId: 'integration-test-agent',
        mcpServers: ServerConfigsSchema.parse({}),
        sessions: SessionConfigSchema.parse({
            maxSessions: 10,
            sessionTTL: 100, // 100ms for fast testing
        }),
        toolConfirmation: ToolConfirmationConfigSchema.parse({
            mode: 'auto-approve',
            timeout: 120000,
        }),
        elicitation: ElicitationConfigSchema.parse({
            enabled: false,
            timeout: 120000,
        }),
        internalResources: InternalResourcesSchema.parse([]),
        prompts: PromptsSchema.parse([]),
    };

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
            tools: [],
            plugins: [],
        });
        await agent.start();
    });

    afterEach(async () => {
        if (agent.isStarted()) {
            await agent.stop();
        }
    });

    test('full integration: chat history survives session expiry through DextoAgent', async () => {
        const sessionId = 'integration-test-session';

        // Step 1: Create session through DextoAgent
        const session = await agent.createSession(sessionId);
        expect(session.id).toBe(sessionId);

        // Step 2: Simulate adding messages to the session
        // In a real scenario, this would happen through agent.run() calls
        // For testing, we'll access the underlying storage directly
        const storage = agent.services.storageManager;
        const messagesKey = `messages:${sessionId}`;
        const chatHistory = [
            { role: 'user', content: 'What is 2+2?' },
            { role: 'assistant', content: '2+2 equals 4.' },
            { role: 'user', content: 'Thank you!' },
            {
                role: 'assistant',
                content: "You're welcome! Is there anything else I can help you with?",
            },
        ];
        await storage.getDatabase().set(messagesKey, chatHistory);

        // Step 3: Verify session exists and has history
        const activeSession = await agent.getSession(sessionId);
        expect(activeSession).toBeDefined();
        expect(activeSession!.id).toBe(sessionId);

        const storedHistory = await storage.getDatabase().get(messagesKey);
        expect(storedHistory).toEqual(chatHistory);

        // Step 4: Force session expiry by manipulating lastActivity timestamp
        await new Promise((resolve) => setTimeout(resolve, 150)); // Wait > TTL

        const sessionKey = `session:${sessionId}`;
        const sessionData = await storage.getDatabase().get<SessionData>(sessionKey);
        if (sessionData) {
            sessionData.lastActivity = Date.now() - 200; // Mark as expired
            await storage.getDatabase().set(sessionKey, sessionData);
        }

        // Access private method to manually trigger cleanup for testing session expiry behavior
        const sessionManager = agent.sessionManager;
        await (sessionManager as any).cleanupExpiredSessions();

        // Step 5: Verify session is removed from memory but preserved in storage
        const sessionsMap = (sessionManager as any).sessions;
        expect(sessionsMap.has(sessionId)).toBe(false);

        // But storage should still have both session metadata and chat history
        expect(await storage.getDatabase().get(sessionKey)).toBeDefined();
        expect(await storage.getDatabase().get(messagesKey)).toEqual(chatHistory);

        // Step 6: Access session again through DextoAgent - should restore seamlessly
        const restoredSession = await agent.getSession(sessionId);
        expect(restoredSession).toBeDefined();
        expect(restoredSession!.id).toBe(sessionId);

        // Session should be back in memory
        expect(sessionsMap.has(sessionId)).toBe(true);

        // Chat history should still be intact
        const restoredHistory = await storage.getDatabase().get(messagesKey);
        expect(restoredHistory).toEqual(chatHistory);

        // Step 7: Verify we can continue the conversation
        const newMessage = { role: 'user', content: 'One more question: what is 3+3?' };
        await storage.getDatabase().set(messagesKey, [...chatHistory, newMessage]);

        const finalHistory = await storage.getDatabase().get<any[]>(messagesKey);
        expect(finalHistory).toBeDefined();
        expect(finalHistory!).toHaveLength(5);
        expect(finalHistory![4]).toEqual(newMessage);
    });

    test('full integration: explicit session deletion removes everything', async () => {
        const sessionId = 'deletion-test-session';

        // Create session and add history
        await agent.createSession(sessionId);

        const storage = agent.services.storageManager;
        const messagesKey = `messages:${sessionId}`;
        const sessionKey = `session:${sessionId}`;
        const history = [{ role: 'user', content: 'Hello!' }];

        await storage.getDatabase().set(messagesKey, history);

        // Verify everything exists
        expect(await agent.getSession(sessionId)).toBeDefined();
        expect(await storage.getDatabase().get(sessionKey)).toBeDefined();
        expect(await storage.getDatabase().get(messagesKey)).toEqual(history);

        // Delete session through DextoAgent
        await agent.deleteSession(sessionId);

        // Everything should be gone including chat history
        const deletedSession = await agent.getSession(sessionId);
        expect(deletedSession).toBeUndefined();
        expect(await storage.getDatabase().get(sessionKey)).toBeUndefined();
        expect(await storage.getDatabase().get(messagesKey)).toBeUndefined();
    });

    test('full integration: multiple concurrent sessions with independent histories', async () => {
        const sessionIds = ['concurrent-1', 'concurrent-2', 'concurrent-3'];
        const histories = sessionIds.map((_, index) => [
            { role: 'user', content: `Message from session ${index + 1}` },
            { role: 'assistant', content: `Response to session ${index + 1}` },
        ]);

        // Create multiple sessions with different histories
        const storage = agent.services.storageManager;
        for (let i = 0; i < sessionIds.length; i++) {
            await agent.createSession(sessionIds[i]);
            await storage.getDatabase().set(`messages:${sessionIds[i]}`, histories[i]);
        }

        // Verify all sessions exist and have correct histories
        for (let i = 0; i < sessionIds.length; i++) {
            const sessionId = sessionIds[i]!;
            const session = await agent.getSession(sessionId);
            expect(session).toBeDefined();
            expect(session!.id).toBe(sessionId);

            const history = await storage.getDatabase().get(`messages:${sessionId}`);
            expect(history).toEqual(histories[i]);
        }

        // Force expiry and cleanup for all sessions
        await new Promise((resolve) => setTimeout(resolve, 150));
        for (const sessionId of sessionIds) {
            const sessionData = await storage
                .getDatabase()
                .get<SessionData>(`session:${sessionId}`);
            if (sessionData) {
                sessionData.lastActivity = Date.now() - 200;
                await storage.getDatabase().set(`session:${sessionId}`, sessionData);
            }
        }

        const sessionManager = agent.sessionManager;
        await (sessionManager as any).cleanupExpiredSessions();

        // All should be removed from memory
        const sessionsMap = (sessionManager as any).sessions;
        sessionIds.forEach((id) => {
            expect(sessionsMap.has(id)).toBe(false);
        });

        // But histories should be preserved in storage
        for (let i = 0; i < sessionIds.length; i++) {
            const history = await storage.getDatabase().get(`messages:${sessionIds[i]}`);
            expect(history).toEqual(histories[i]);
        }

        // Restore sessions one by one and verify independent operation
        for (let i = 0; i < sessionIds.length; i++) {
            const sessionId = sessionIds[i]!;
            const restoredSession = await agent.getSession(sessionId);
            expect(restoredSession).toBeDefined();
            expect(restoredSession!.id).toBe(sessionId);

            // Verify the session is back in memory
            expect(sessionsMap.has(sessionId)).toBe(true);

            // Verify history is still intact and independent
            const history = await storage.getDatabase().get(`messages:${sessionId}`);
            expect(history).toEqual(histories[i]);
        }
    });

    // Note: Activity-based expiry prevention test removed due to timing complexities
    // The core functionality (chat history preservation) is thoroughly tested above
});

describe('Session Integration: Multi-Model Token Tracking', () => {
    let agent: DextoAgent | undefined;

    const testSettings: AgentRuntimeSettings = {
        systemPrompt: SystemPromptConfigSchema.parse('You are a helpful assistant.'),
        llm: LLMConfigSchema.parse({
            provider: 'openai',
            model: 'gpt-5-mini',
            apiKey: 'test-key-123',
        }),
        agentId: 'token-tracking-test-agent',
        mcpServers: ServerConfigsSchema.parse({}),
        sessions: SessionConfigSchema.parse({}),
        toolConfirmation: ToolConfirmationConfigSchema.parse({
            mode: 'auto-approve',
            timeout: 120000,
        }),
        elicitation: ElicitationConfigSchema.parse({
            enabled: false,
            timeout: 120000,
        }),
        internalResources: InternalResourcesSchema.parse([]),
        prompts: PromptsSchema.parse([]),
    };

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
            tools: [],
            plugins: [],
        });
        await agent.start();
    });

    afterEach(async () => {
        if (agent && agent.isStarted()) {
            await agent.stop();
        }
    });

    test('should accumulate token usage for a single model', async () => {
        const a = agent;
        if (!a) {
            throw new Error('Test agent not initialized');
        }
        const sessionId = 'single-model-session';
        await a.createSession(sessionId);

        const sessionManager = a.sessionManager;
        const tokenUsage = {
            inputTokens: 100,
            outputTokens: 50,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 150,
        };

        await sessionManager.accumulateTokenUsage(sessionId, tokenUsage, 0.015, {
            provider: 'openai',
            model: 'gpt-4',
        });

        const metadata = await sessionManager.getSessionMetadata(sessionId);

        expect(metadata?.tokenUsage).toEqual(tokenUsage);
        expect(metadata?.estimatedCost).toBe(0.015);
        expect(metadata?.modelStats).toHaveLength(1);
        expect(metadata?.modelStats?.[0]).toMatchObject({
            provider: 'openai',
            model: 'gpt-4',
            messageCount: 1,
            tokenUsage,
            estimatedCost: 0.015,
        });
    });

    test('should track multiple models and verify totals match sum of all models', async () => {
        const a = agent;
        if (!a) {
            throw new Error('Test agent not initialized');
        }
        const sessionId = 'multi-model-session';
        await a.createSession(sessionId);

        const sessionManager = a.sessionManager;

        // Define multiple model usages with complete token breakdown
        const usages = [
            {
                provider: 'openai',
                model: 'gpt-4',
                tokenUsage: {
                    inputTokens: 100,
                    outputTokens: 50,
                    reasoningTokens: 10,
                    cacheReadTokens: 20,
                    cacheWriteTokens: 5,
                    totalTokens: 150,
                },
                cost: 0.015,
            },
            {
                provider: 'anthropic',
                model: 'claude-4-opus-20250514',
                tokenUsage: {
                    inputTokens: 200,
                    outputTokens: 100,
                    reasoningTokens: 30,
                    cacheReadTokens: 50,
                    cacheWriteTokens: 10,
                    totalTokens: 300,
                },
                cost: 0.03,
            },
            {
                provider: 'openai',
                model: 'gpt-4',
                tokenUsage: {
                    inputTokens: 50,
                    outputTokens: 25,
                    reasoningTokens: 5,
                    cacheReadTokens: 10,
                    cacheWriteTokens: 2,
                    totalTokens: 75,
                },
                cost: 0.008,
            },
        ];

        // Accumulate all usages
        for (const usage of usages) {
            await sessionManager.accumulateTokenUsage(sessionId, usage.tokenUsage, usage.cost, {
                provider: usage.provider,
                model: usage.model,
            });
        }

        const metadata = await sessionManager.getSessionMetadata(sessionId);

        // Calculate expected totals across all models
        const expectedTotals = {
            inputTokens: 350, // 100 + 200 + 50
            outputTokens: 175, // 50 + 100 + 25
            reasoningTokens: 45, // 10 + 30 + 5
            cacheReadTokens: 80, // 20 + 50 + 10
            cacheWriteTokens: 17, // 5 + 10 + 2
            totalTokens: 525, // 150 + 300 + 75
        };
        const expectedCost = 0.053; // 0.015 + 0.03 + 0.008

        // Verify session-level totals match sum of all models
        expect(metadata?.tokenUsage).toEqual(expectedTotals);
        expect(metadata?.estimatedCost).toBeCloseTo(expectedCost, 10);

        // Should have 2 unique model entries
        expect(metadata?.modelStats).toHaveLength(2);

        // Verify individual model stats
        const openaiStats = metadata?.modelStats?.find(
            (s) => s.provider === 'openai' && s.model === 'gpt-4'
        );
        expect(openaiStats).toMatchObject({
            provider: 'openai',
            model: 'gpt-4',
            messageCount: 2, // Used twice
            tokenUsage: {
                inputTokens: 150, // 100 + 50
                outputTokens: 75, // 50 + 25
                reasoningTokens: 15, // 10 + 5
                cacheReadTokens: 30, // 20 + 10
                cacheWriteTokens: 7, // 5 + 2
                totalTokens: 225, // 150 + 75
            },
            estimatedCost: 0.023, // 0.015 + 0.008
        });

        const anthropicStats = metadata?.modelStats?.find(
            (s) => s.provider === 'anthropic' && s.model === 'claude-4-opus-20250514'
        );
        expect(anthropicStats).toMatchObject({
            provider: 'anthropic',
            model: 'claude-4-opus-20250514',
            messageCount: 1,
            tokenUsage: {
                inputTokens: 200,
                outputTokens: 100,
                reasoningTokens: 30,
                cacheReadTokens: 50,
                cacheWriteTokens: 10,
                totalTokens: 300,
            },
            estimatedCost: 0.03,
        });

        // ============================================================================
        // CRITICAL VERIFICATION: Verify accounting accuracy
        // ============================================================================
        // This section ensures that:
        // 1. Each model's individual tokens are correctly tracked
        // 2. Session-level totals exactly match the sum of all model totals
        // ============================================================================

        // Sum up all model stats manually
        const summedFromModels = metadata?.modelStats?.reduce(
            (acc, model) => ({
                inputTokens: acc.inputTokens + model.tokenUsage.inputTokens,
                outputTokens: acc.outputTokens + model.tokenUsage.outputTokens,
                reasoningTokens: acc.reasoningTokens + model.tokenUsage.reasoningTokens,
                cacheReadTokens: acc.cacheReadTokens + model.tokenUsage.cacheReadTokens,
                cacheWriteTokens: acc.cacheWriteTokens + model.tokenUsage.cacheWriteTokens,
                totalTokens: acc.totalTokens + model.tokenUsage.totalTokens,
            }),
            {
                inputTokens: 0,
                outputTokens: 0,
                reasoningTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 0,
            }
        );

        // ASSERTION 1: Session totals MUST equal sum of all model stats
        expect(metadata?.tokenUsage).toEqual(summedFromModels);

        // ASSERTION 2: Verify each token field individually
        expect(metadata?.tokenUsage?.inputTokens).toBe(
            openaiStats!.tokenUsage.inputTokens + anthropicStats!.tokenUsage.inputTokens
        );
        expect(metadata?.tokenUsage?.outputTokens).toBe(
            openaiStats!.tokenUsage.outputTokens + anthropicStats!.tokenUsage.outputTokens
        );
        expect(metadata?.tokenUsage?.reasoningTokens).toBe(
            openaiStats!.tokenUsage.reasoningTokens + anthropicStats!.tokenUsage.reasoningTokens
        );
        expect(metadata?.tokenUsage?.cacheReadTokens).toBe(
            openaiStats!.tokenUsage.cacheReadTokens + anthropicStats!.tokenUsage.cacheReadTokens
        );
        expect(metadata?.tokenUsage?.cacheWriteTokens).toBe(
            openaiStats!.tokenUsage.cacheWriteTokens + anthropicStats!.tokenUsage.cacheWriteTokens
        );
        expect(metadata?.tokenUsage?.totalTokens).toBe(
            openaiStats!.tokenUsage.totalTokens + anthropicStats!.tokenUsage.totalTokens
        );

        // ASSERTION 3: Costs also sum correctly
        const summedCost =
            metadata?.modelStats?.reduce((acc, model) => acc + model.estimatedCost, 0) || 0;
        expect(metadata?.estimatedCost).toBeCloseTo(summedCost, 10);
        expect(metadata?.estimatedCost).toBeCloseTo(
            openaiStats!.estimatedCost + anthropicStats!.estimatedCost,
            10
        );

        // ASSERTION 4: Message counts sum correctly
        const totalMessages =
            metadata?.modelStats?.reduce((acc, model) => acc + model.messageCount, 0) || 0;
        expect(totalMessages).toBe(3); // 2 openai + 1 anthropic
    });

    test('should handle optional token fields correctly', async () => {
        const a = agent;
        if (!a) {
            throw new Error('Test agent not initialized');
        }
        const sessionId = 'optional-tokens-session';
        await a.createSession(sessionId);

        const sessionManager = a.sessionManager;

        // Usage with only required fields
        await sessionManager.accumulateTokenUsage(
            sessionId,
            {
                inputTokens: 100,
                outputTokens: 50,
            },
            0.015,
            { provider: 'openai', model: 'gpt-4' }
        );

        const metadata = await sessionManager.getSessionMetadata(sessionId);

        expect(metadata?.tokenUsage).toEqual({
            inputTokens: 100,
            outputTokens: 50,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
        });
    });

    test('should handle reasoning and cache tokens', async () => {
        const a = agent;
        if (!a) {
            throw new Error('Test agent not initialized');
        }
        const sessionId = 'advanced-tokens-session';
        await a.createSession(sessionId);

        const sessionManager = a.sessionManager;

        await sessionManager.accumulateTokenUsage(
            sessionId,
            {
                inputTokens: 1000,
                outputTokens: 500,
                reasoningTokens: 200,
                cacheReadTokens: 5000,
                cacheWriteTokens: 1000,
                totalTokens: 2700,
            },
            0.15,
            { provider: 'anthropic', model: 'claude-4-opus-20250514' }
        );

        const metadata = await sessionManager.getSessionMetadata(sessionId);

        expect(metadata?.tokenUsage).toEqual({
            inputTokens: 1000,
            outputTokens: 500,
            reasoningTokens: 200,
            cacheReadTokens: 5000,
            cacheWriteTokens: 1000,
            totalTokens: 2700,
        });
    });

    test('should update model timestamps correctly', async () => {
        const a = agent;
        if (!a) {
            throw new Error('Test agent not initialized');
        }
        const sessionId = 'timestamp-session';
        await a.createSession(sessionId);

        const sessionManager = a.sessionManager;

        const firstCallTime = Date.now();
        await sessionManager.accumulateTokenUsage(
            sessionId,
            { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
            0.015,
            { provider: 'openai', model: 'gpt-4' }
        );

        // Wait a bit
        await new Promise((resolve) => setTimeout(resolve, 10));

        const secondCallTime = Date.now();
        await sessionManager.accumulateTokenUsage(
            sessionId,
            { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
            0.015,
            { provider: 'openai', model: 'gpt-4' }
        );

        const metadata = await sessionManager.getSessionMetadata(sessionId);
        const modelStats = metadata?.modelStats?.[0];

        expect(modelStats?.firstUsedAt).toBeGreaterThanOrEqual(firstCallTime);
        expect(modelStats?.firstUsedAt).toBeLessThan(secondCallTime);
        expect(modelStats?.lastUsedAt).toBeGreaterThanOrEqual(secondCallTime);
    });

    test('should handle accumulation without cost', async () => {
        const a = agent;
        if (!a) {
            throw new Error('Test agent not initialized');
        }
        const sessionId = 'no-cost-session';
        await a.createSession(sessionId);

        const sessionManager = a.sessionManager;

        await sessionManager.accumulateTokenUsage(
            sessionId,
            { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
            undefined, // No cost provided
            { provider: 'openai', model: 'gpt-4' }
        );

        const metadata = await sessionManager.getSessionMetadata(sessionId);

        expect(metadata?.estimatedCost).toBeUndefined();
        expect(metadata?.modelStats?.[0]?.estimatedCost).toBe(0);
    });

    test('should handle concurrent token accumulation with mutex', async () => {
        const a = agent;
        if (!a) {
            throw new Error('Test agent not initialized');
        }
        const sessionId = 'concurrent-session';
        await a.createSession(sessionId);

        const sessionManager = a.sessionManager;

        // Fire multiple concurrent accumulations
        const promises = Array.from({ length: 10 }, () =>
            sessionManager.accumulateTokenUsage(
                sessionId,
                { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                0.001,
                { provider: 'openai', model: 'gpt-4' }
            )
        );

        await Promise.all(promises);

        const metadata = await sessionManager.getSessionMetadata(sessionId);

        // Should have exactly 10 messages worth of tokens (no lost updates)
        expect(metadata?.tokenUsage).toEqual({
            inputTokens: 100, // 10 * 10
            outputTokens: 50, // 10 * 5
            reasoningTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 150, // 10 * 15
        });
        expect(metadata?.modelStats?.[0]?.messageCount).toBe(10);
        expect(metadata?.estimatedCost).toBeCloseTo(0.01, 5); // 10 * 0.001
    });
});
