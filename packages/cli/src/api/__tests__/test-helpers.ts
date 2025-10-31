import type { DextoAgent } from '@dexto/core';
import { AgentEventBus } from '@dexto/core';
import type { Express } from 'express';
import type { Server as HttpServer } from 'http';
import { initializeApi } from '../server.js';
import { initializeHonoApi } from '../server-hono.js';

export type ApiServerType = 'express' | 'hono';

export interface TestServer {
    type: ApiServerType;
    app: Express | any; // Hono app type differs
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
        updateAndSaveConfig: async () => {},
        reloadConfig: async () => ({ restartRequired: [] }),
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
        },
        listPrompts: async () => ({}),
        getPromptDefinition: async () => null,
        resolvePrompt: async () => ({ text: '', resources: [] }),
        createCustomPrompt: async () => ({ name: 'test', content: '' }),
        deleteCustomPrompt: async () => {},
    } as unknown as DextoAgent;
}

/**
 * Starts an Express API server for testing
 */
export async function startExpressServer(agent: DextoAgent, port?: number): Promise<TestServer> {
    const { app, server } = await initializeApi(agent, undefined, port);
    return {
        type: 'express',
        app: app as Express,
        server: server as HttpServer,
    };
}

/**
 * Starts a Hono API server for testing
 */
export async function startHonoServer(agent: DextoAgent, port?: number): Promise<TestServer> {
    const { app, server } = await initializeHonoApi(agent, undefined, port);
    return {
        type: 'hono',
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

/**
 * Creates a test server based on type
 */
export async function createTestServer(
    type: ApiServerType,
    agent: DextoAgent,
    port?: number
): Promise<TestServer> {
    if (type === 'express') {
        return startExpressServer(agent, port);
    } else {
        return startHonoServer(agent, port);
    }
}

/**
 * Helper to get the request handler for supertest
 * Works with both Express and Hono apps
 */
export function getRequestHandler(testServer: TestServer): Express {
    if (testServer.type === 'express') {
        return testServer.app as Express;
    }
    // For Hono, we need to use the fetch API adapter or wrap it
    // Supertest works with Express-compatible handlers
    // Hono can be tested via fetch or we need to create an Express wrapper
    // For now, this is a placeholder - Hono tests might need a different approach
    return testServer.app as any;
}
