import type { Server } from 'node:http';
import type { Context } from 'hono';
import type { DextoAgent, AgentCard } from '@dexto/core';
import { createAgentCard, logger, startLlmRegistryAutoUpdate } from '@dexto/core';
import { createDextoApp } from './index.js';
import { createNodeServer } from './node/index.js';
import type { DextoApp } from './types.js';
import type { WebUIRuntimeConfig } from './routes/static.js';
import { WebhookEventSubscriber } from '../events/webhook-subscriber.js';
import { A2ASseEventSubscriber } from '../events/a2a-sse-subscriber.js';
import { ApprovalCoordinator } from '../approval/approval-coordinator.js';
import { createManualApprovalHandler } from '../approval/manual-approval-handler.js';

export type StartDextoServerOptions = {
    /** Port to listen on. Defaults to 3000 or process.env.PORT */
    port?: number;
    /** Hostname to bind to. Defaults to 0.0.0.0 */
    hostname?: string;
    /** Override agent card metadata (name, version, etc.) */
    agentCard?: Partial<AgentCard>;
    /** Absolute path to WebUI build output. If provided, static files will be served. */
    webRoot?: string;
    /** Runtime configuration to inject into WebUI (analytics, etc.) */
    webUIConfig?: WebUIRuntimeConfig;
    /** Base URL for agent card. Defaults to http://localhost:{port} */
    baseUrl?: string;
};

export type StartDextoServerResult = {
    /** HTTP server instance */
    server: Server;
    /** Hono app instance */
    app: DextoApp;
    /** Stop the server and agent gracefully */
    stop: () => Promise<void>;
    /** Agent card with resolved metadata */
    agentCard: AgentCard;
};

/**
 * Start a Dexto server with minimal configuration.
 *
 * This is a high-level helper that:
 * 1. Creates event subscribers and approval coordinator
 * 2. Creates and configures the Hono app
 * 3. Wires up all the infrastructure (SSE, webhooks, approvals)
 * 4. Starts the agent
 * 5. Starts the HTTP server
 *
 * @example
 * ```typescript
 * // Register providers (filesystem-tools, process-tools, etc.)
 * import '@dexto/image-local';
 *
 * import { DextoAgent } from '@dexto/core';
 * import { loadAgentConfig } from '@dexto/agent-management';
 * import { startDextoServer } from '@dexto/server';
 *
 * const config = await loadAgentConfig('./agents/default.yml');
 * const agent = new DextoAgent(config, './agents/default.yml');
 *
 * const { server, stop } = await startDextoServer(agent, {
 *   port: 3000,
 *   agentCard: { name: 'My Agent' }
 * });
 *
 * // Server is now running at http://localhost:3000
 * // To stop: await stop();
 * ```
 */
export async function startDextoServer(
    agent: DextoAgent,
    options: StartDextoServerOptions = {}
): Promise<StartDextoServerResult> {
    // Keep LLM registry metadata (pricing/capabilities/limits) self-updating in server mode too.
    startLlmRegistryAutoUpdate();

    const {
        port: requestedPort,
        hostname = '0.0.0.0',
        agentCard: agentCardOverride = {},
        webRoot,
        webUIConfig,
        baseUrl: baseUrlOverride,
    } = options;

    // Resolve port from options, env, or default
    const resolvedPort = requestedPort ?? (process.env.PORT ? Number(process.env.PORT) : 3000);
    const baseUrl = baseUrlOverride ?? `http://localhost:${resolvedPort}`;

    logger.info(`Initializing Dexto server on ${hostname}:${resolvedPort}...`);

    // Create agent card with overrides
    const agentCard = createAgentCard(
        {
            defaultName: agentCardOverride.name ?? 'dexto-agent',
            defaultVersion: agentCardOverride.version ?? '1.0.0',
            defaultBaseUrl: baseUrl,
        },
        agentCardOverride
    );

    // Create event subscribers and approval coordinator
    logger.debug('Creating event infrastructure...');
    const webhookSubscriber = new WebhookEventSubscriber();
    const sseSubscriber = new A2ASseEventSubscriber();
    const approvalCoordinator = new ApprovalCoordinator();

    // Create Hono app
    logger.debug('Creating Hono application...');
    const app = createDextoApp({
        getAgent: (_ctx: Context) => agent,
        getAgentCard: () => agentCard,
        approvalCoordinator,
        webhookSubscriber,
        sseSubscriber,
        ...(webRoot ? { webRoot } : {}),
        ...(webUIConfig ? { webUIConfig } : {}),
    });

    // Create Node.js HTTP server
    logger.debug('Creating Node.js HTTP server...');
    const { server, webhookSubscriber: bridgeWebhookSubscriber } = createNodeServer(app, {
        getAgent: () => agent,
        port: resolvedPort,
        hostname,
    });

    // Register webhook subscriber with agent for LLM streaming events
    if (bridgeWebhookSubscriber) {
        logger.debug('Registering webhook subscriber with agent...');
        agent.registerSubscriber(bridgeWebhookSubscriber);
    }

    // Set approval handler if manual mode OR elicitation enabled
    const needsHandler =
        agent.config.toolConfirmation?.mode === 'manual' || agent.config.elicitation.enabled;

    if (needsHandler) {
        logger.debug('Setting up manual approval handler...');
        const handler = createManualApprovalHandler(approvalCoordinator);
        agent.setApprovalHandler(handler);
    }

    // Wire SSE subscribers to agent event bus
    logger.debug('Wiring event subscribers to agent...');
    agent.registerSubscriber(webhookSubscriber);
    agent.registerSubscriber(sseSubscriber);

    // Start the agent
    logger.info('Starting agent...');
    await agent.start();

    logger.info(`Server running at http://${hostname}:${resolvedPort}`, null, 'green');

    // Return result with stop function
    return {
        server,
        app,
        agentCard,
        stop: async () => {
            logger.info('Stopping Dexto server...');
            await agent.stop();
            server.close();
            logger.info('Server stopped', null, 'yellow');
        },
    };
}
