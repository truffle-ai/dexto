import type { DextoAgent, AgentConfig } from '@dexto/core';
import { AgentEventBus } from '@dexto/core';
import type { Server as HttpServer } from 'http';
import { initializeHonoApi } from '../server-hono.js';

export interface TestServer {
    app: unknown; // DextoApp from server-hono
    server: HttpServer | null;
    url?: string; // For external HTTP testing
}

/**
 * Creates a mock agent for testing
 */
export function createMockAgent(): DextoAgent {
    const agentEventBus = new AgentEventBus();
    return {
        agentEventBus,
        stop: async () => {},
        isStarted: () => true,
        isStopped: () => false,
        start: async () => {},
        listAgents: async () => ({
            installed: [],
            available: [],
            current: { id: null, name: null },
        }),
        installAgent: async () => {},
        getCurrentLLMConfig: () => ({ provider: 'openai', model: 'gpt-5', router: 'vercel' }),
        getEffectiveConfig: (sessionId?: string) => ({
            llm:
                sessionId === 'abc'
                    ? {
                          provider: 'anthropic',
                          model: 'claude-4-sonnet-20250514',
                          router: 'in-built',
                      }
                    : { provider: 'openai', model: 'gpt-5', router: 'vercel' },
        }),
        run: async () => ({}),
        resetConversation: async () => {},
        listSessions: async () => [],
        createSession: async (id?: string) => ({ id: id ?? 'test-session' }),
        getSessionMetadata: async () => ({
            createdAt: Date.now(),
            lastActivity: Date.now(),
            messageCount: 0,
            title: null,
        }),
        getSessionHistory: async () => [],
        getCurrentSessionId: () => null,
        switchLLM: async () => ({ provider: 'openai', model: 'gpt-5', router: 'vercel' }),
        searchMessages: async () => ({ results: [] }),
        searchSessions: async () => ({ results: [] }),
        registerSubscriber: () => {},
        restart: async () => {},
        // Additional methods that might be needed
        deleteSession: async () => {},
        loadSessionAsDefault: async () => {},
        setSessionTitle: async () => {},
        cancel: async () => false,
        getAgentFilePath: () => '/tmp/test-agent.yml',
        reload: async (_newConfig: AgentConfig) => ({ restarted: false, changesApplied: [] }),
        getMcpClients: () => new Map(),
        getMcpFailedConnections: () => ({}),
        connectMcpServer: async () => {},
        removeMcpServer: async () => {},
        restartMcpServer: async () => {},
        listResourcesForServer: async () => [],
        readResource: async () => ({ content: '', mimeType: 'text/plain' }),
        hasResource: async () => false,
        listResources: async () => ({}),
        memoryManager: {
            create: async () => ({ id: 'test-memory', content: '', createdAt: Date.now() }),
            list: async () => [],
            get: async () => ({ id: 'test-memory', content: '', createdAt: Date.now() }),
            update: async () => ({ id: 'test-memory', content: '', createdAt: Date.now() }),
            delete: async () => {},
            count: async () => 0,
        },
        listPrompts: async () => ({}),
        getPromptDefinition: async () => null,
        resolvePrompt: async () => ({ text: '', resources: [] }),
        createCustomPrompt: async () => ({ name: 'test', content: '' }),
        deleteCustomPrompt: async () => {},
    } as unknown as DextoAgent;
}

/**
 * Starts a Hono API server for testing
 */
export async function startTestServer(agent: DextoAgent, port?: number): Promise<TestServer> {
    const { app, server } = await initializeHonoApi(agent, undefined, port);
    return {
        app,
        server: server as HttpServer,
    };
}

/**
 * Stops a test server
 */
export async function stopServer(testServer: TestServer): Promise<void> {
    if (testServer.server) {
        await new Promise<void>((resolve, reject) => {
            testServer.server!.close((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
}
