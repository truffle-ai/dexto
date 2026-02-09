import { AgentConfigSchema, DextoAgent, createAgentCard, createLogger } from '@dexto/core';
import type { AgentConfig, AgentCard } from '@dexto/core';
import type { Server as HttpServer } from 'node:http';
import type { Context } from 'hono';
import { createDextoApp } from '../index.js';
import type { DextoApp } from '../types.js';
import { createNodeServer, type NodeBridgeResult } from '../node/index.js';
import type { CreateDextoAppOptions } from '../index.js';

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
            maxIterations: 10,
        },
        mcpServers: {},
        storage: {
            cache: { type: 'in-memory' },
            database: { type: 'in-memory' },
            blob: { type: 'local', storePath: '/tmp/test-blobs' },
        },
        sessions: {
            maxSessions: 50, // Increased to accommodate all integration tests
            sessionTTL: 3600,
        },
        toolConfirmation: {
            mode: 'auto-approve',
            timeout: 120000,
        },
        elicitation: {
            enabled: false,
            timeout: 120000,
        },
    };
}

/**
 * Creates a real DextoAgent instance with in-memory storage
 * No mocks - uses real implementations
 */
export async function createTestAgent(config?: AgentConfig): Promise<DextoAgent> {
    const agentConfig = config ?? createTestAgentConfig();
    const validatedConfig = AgentConfigSchema.parse(agentConfig);
    const logger = createLogger({
        config: validatedConfig.logger,
        agentId: validatedConfig.agentId,
    });
    const agent = new DextoAgent({ config: validatedConfig, logger });
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
 * @param agent - The agent instance to use
 * @param port - Optional port (auto-selected if not provided)
 * @param agentsContext - Optional agent switching context (enables /api/agents routes)
 */
export async function startTestServer(
    agent: DextoAgent,
    port?: number,
    agentsContext?: CreateDextoAppOptions['agentsContext']
): Promise<TestServer> {
    // Use provided port or find an available port
    const serverPort = port ?? (await findAvailablePort());

    // Create agent card
    const agentCard = createAgentCard({
        defaultName: 'test-agent',
        defaultVersion: '1.0.0',
        defaultBaseUrl: `http://localhost:${serverPort}`,
    });

    // Create getter functions
    // Note: For agent switching tests, getAgent needs to reference activeAgent from agentsContext
    // This is handled by the agentsContext implementation itself
    const getAgent = (_ctx: Context) => agent;
    const getAgentCard = () => agentCard;

    // Create event subscribers and approval coordinator for test
    const { WebhookEventSubscriber } = await import('../../events/webhook-subscriber.js');
    const { A2ASseEventSubscriber } = await import('../../events/a2a-sse-subscriber.js');
    const { ApprovalCoordinator } = await import('../../approval/approval-coordinator.js');

    const webhookSubscriber = new WebhookEventSubscriber();
    const sseSubscriber = new A2ASseEventSubscriber();
    const approvalCoordinator = new ApprovalCoordinator();

    // Subscribe to agent's event bus
    webhookSubscriber.subscribe(agent.agentEventBus);
    sseSubscriber.subscribe(agent.agentEventBus);

    // Create Hono app
    const app = createDextoApp({
        getAgent,
        getAgentCard,
        approvalCoordinator,
        webhookSubscriber,
        sseSubscriber,
        ...(agentsContext ? { agentsContext } : {}), // Include agentsContext only if provided
    });

    // Create Node server bridge
    const bridge = createNodeServer(app, {
        getAgent: () => agent,
        port: serverPort,
    });

    // Agent card (no updates needed after bridge creation in SSE migration)
    const updatedAgentCard = createAgentCard({
        defaultName: 'test-agent',
        defaultVersion: '1.0.0',
        defaultBaseUrl: `http://localhost:${serverPort}`,
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
            // Cleanup subscribers to prevent memory leaks
            webhookSubscriber.cleanup();
            sseSubscriber.cleanup();
            approvalCoordinator.removeAllListeners();

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
    headers: Record<string, string>;
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

    // Convert Headers to plain object for serialization
    const headersObject: Record<string, string> = {};
    response.headers.forEach((value, key) => {
        headersObject[key] = value;
    });

    return {
        status: response.status,
        headers: headersObject,
        body: parsedBody,
        text,
    };
}

/**
 * Validates that a response has the expected structure
 */
export function expectResponseStructure(
    body: unknown,
    schema: Record<string, (value: unknown) => boolean>
): void {
    if (typeof body !== 'object' || body === null) {
        throw new Error(`Expected object response, got ${typeof body}`);
    }

    const bodyObj = body as Record<string, unknown>;
    for (const [key, validator] of Object.entries(schema)) {
        if (!(key in bodyObj)) {
            throw new Error(`Missing required field: ${key}`);
        }
        if (!validator(bodyObj[key])) {
            throw new Error(
                `Invalid type for field '${key}': expected validator to return true, got false`
            );
        }
    }
}

/**
 * Common response validators
 */
export const validators = {
    string: (value: unknown): boolean => typeof value === 'string',
    number: (value: unknown): boolean => typeof value === 'number',
    boolean: (value: unknown): boolean => typeof value === 'boolean',
    array: (value: unknown): boolean => Array.isArray(value),
    object: (value: unknown): boolean =>
        typeof value === 'object' && value !== null && !Array.isArray(value),
    optionalString: (value: unknown): boolean => value === undefined || typeof value === 'string',
    optionalNumber: (value: unknown): boolean => value === undefined || typeof value === 'number',
    optionalArray: (value: unknown): boolean => value === undefined || Array.isArray(value),
    optionalObject: (value: unknown): boolean =>
        value === undefined ||
        (typeof value === 'object' && value !== null && !Array.isArray(value)),
};
