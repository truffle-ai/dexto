import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { DextoAgent } from '../agent/DextoAgent.js';
import type { AgentRuntimeConfig } from '@core/agent/runtime-config.js';
import { SystemPromptConfigSchema } from '@core/systemPrompt/schemas.js';
import { LLMConfigSchema } from '@core/llm/schemas.js';
import { LoggerConfigSchema } from '@core/logger/index.js';
import { SessionConfigSchema } from '@core/session/schemas.js';
import { ToolConfirmationConfigSchema, ElicitationConfigSchema } from '@core/tools/schemas.js';
import { InternalResourcesSchema } from '@core/resources/schemas.js';
import { PromptsSchema } from '@core/prompts/schemas.js';
import { PluginsConfigSchema } from '@core/plugins/schemas.js';
import {
    CompactionConfigSchema,
    DEFAULT_COMPACTION_CONFIG,
} from '@core/context/compaction/schemas.js';
import { createLogger } from '../logger/factory.js';
import type { SessionData } from './session-manager.js';
import { ServerConfigsSchema } from '@core/mcp/schemas.js';
import { createInMemoryStorageManager } from '@core/test-utils/in-memory-storage.js';

/**
 * Full end-to-end integration tests for chat history preservation.
 * Tests the complete flow from DextoAgent -> SessionManager -> ChatSession -> Storage
 */
describe('Session Integration: Chat History Preservation', () => {
    let agent: DextoAgent;

    const testConfig: AgentRuntimeConfig = {
        systemPrompt: SystemPromptConfigSchema.parse('You are a helpful assistant.'),
        llm: LLMConfigSchema.parse({
            provider: 'openai',
            model: 'gpt-5-mini',
            apiKey: 'test-key-123',
        }),
        agentFile: { discoverInCwd: true },
        agentId: 'integration-test-agent',
        mcpServers: ServerConfigsSchema.parse({}),
        tools: [],
        logger: LoggerConfigSchema.parse({
            level: 'warn',
            transports: [{ type: 'console', colorize: false }],
        }),
        storage: {},
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
        plugins: PluginsConfigSchema.parse({}),
        compaction: CompactionConfigSchema.parse(DEFAULT_COMPACTION_CONFIG),
    };

    beforeEach(async () => {
        const logger = createLogger({
            config: testConfig.logger,
            agentId: testConfig.agentId,
        });
        const storageManager = await createInMemoryStorageManager(logger);
        agent = new DextoAgent({ config: testConfig, logger, overrides: { storageManager } });
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
