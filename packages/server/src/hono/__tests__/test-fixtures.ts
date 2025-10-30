import { DextoAgent, createAgentCard } from '@dexto/core';
import type { AgentConfig, AgentCard } from '@dexto/core';
import type { Server as HttpServer } from 'node:http';
import { createDextoApp } from '../index.js';
import type { DextoApp } from '../types.js';
import { createNodeServer, type NodeBridgeResult } from '../node/index.js';

/**
 * Test configuration for integration tests
 * Uses in-memory storage to avoid side effects
 */
export function createTestAgentConfig(): AgentConfig {
    return {
        systemPrompt: 'You are a test assistant.',
        llm: {
            provider: 'openai',
            model: 'gpt-5-nano',
            apiKey: 'test-key-123', // Mock key for testing
            router: 'vercel',
            maxIterations: 10,
        },
        mcpServers: {},
        storage: {
            cache: { type: 'in-memory' },
            database: { type: 'in-memory' },
        },
        sessions: {
            maxSessions: 10,
            sessionTTL: 3600,
        },
    };
}

/**
 * Creates a real DextoAgent instance with in-memory storage
 * No mocks - uses real implementations
 */
export async function createTestAgent(config?: AgentConfig): Promise<DextoAgent> {
    const agentConfig = config ?? createTestAgentConfig();
    const agent = new DextoAgent(agentConfig);
    await agent.start();
    return agent;
}

/**
 * Test server setup result
 */
export interface TestServer {
    server: HttpServer;
    app: DextoApp;
    bridge: NodeBridgeResult;
    agent: DextoAgent;
    agentCard: AgentCard;
    baseUrl: string;
    port: number;
    cleanup: () => Promise<void>;
}

/**
 * Starts a real HTTP server for testing
 * Uses createDextoApp and createNodeServer directly
 */
export async function startTestServer(agent: DextoAgent, port?: number): Promise<TestServer> {
    // Use provided port or find an available port
    const serverPort = port ?? (await findAvailablePort());

    // Create agent card
    const agentCard = createAgentCard({
        defaultName: 'test-agent',
        defaultVersion: '1.0.0',
        defaultBaseUrl: `http://localhost:${serverPort}`,
        webSubscriber: false, // Will be updated after bridge creation
    });

    // Create getter functions
    const getAgent = () => agent;
    const getAgentCard = () => agentCard;

    // Create Hono app
    const app = createDextoApp({
        getAgent,
        getAgentCard,
        // No agentsContext for basic tests (can be added later for agent switching tests)
    });

    // Create Node server bridge
    const bridge = createNodeServer(app, {
        agent,
        port: serverPort,
    });

    // Update agent card with web subscriber
    const updatedAgentCard = createAgentCard({
        defaultName: 'test-agent',
        defaultVersion: '1.0.0',
        defaultBaseUrl: `http://localhost:${serverPort}`,
        webSubscriber: bridge.webSubscriber,
    });

    // Start the server
    await new Promise<void>((resolve, reject) => {
        bridge.server.listen(serverPort, '0.0.0.0', () => {
            resolve();
        });
        bridge.server.on('error', reject);
    });

    const baseUrl = `http://localhost:${serverPort}`;

    return {
        server: bridge.server,
        app,
        bridge,
        agent,
        agentCard: updatedAgentCard,
        baseUrl,
        port: serverPort,
        cleanup: async () => {
            await new Promise<void>((resolve, reject) => {
                bridge.server.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            if (agent.isStarted()) {
                await agent.stop();
            }
        },
    };
}

/**
 * Finds an available port starting from a random port in the ephemeral range
 * Uses ports 49152-65535 (IANA ephemeral port range)
 */
async function findAvailablePort(): Promise<number> {
    const { createServer } = await import('node:http');
    // Start from a random port in the ephemeral range to avoid conflicts
    const startPort = 49152 + Math.floor(Math.random() * 1000);

    for (let port = startPort; port < 65535; port++) {
        try {
            await new Promise<void>((resolve, reject) => {
                const server = createServer();
                server.on('error', (err: NodeJS.ErrnoException) => {
                    if (err.code === 'EADDRINUSE') {
                        reject(new Error(`Port ${port} is in use`));
                    } else {
                        reject(err);
                    }
                });
                server.listen(port, () => {
                    server.close(() => resolve());
                });
            });
            return port;
        } catch {
            // Port is in use, try next
            continue;
        }
    }
    throw new Error(`Could not find an available port starting from ${startPort}`);
}

/**
 * Helper to make HTTP requests to the test server
 */
export async function httpRequest(
    baseUrl: string,
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>
): Promise<{
    status: number;
    headers: Headers;
    body: unknown;
    text: string;
}> {
    const url = `${baseUrl}${path}`;
    const options: RequestInit = {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...headers,
        },
    };

    if (body !== undefined) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const text = await response.text();
    let parsedBody: unknown;
    try {
        parsedBody = JSON.parse(text);
    } catch {
        parsedBody = text;
    }

    return {
        status: response.status,
        headers: response.headers,
        body: parsedBody,
        text,
    };
}
