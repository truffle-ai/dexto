import os from 'node:os';
import type { AgentCard } from '@dexto/core';
import { createAgentCard, logger, AgentError, DextoAgent } from '@dexto/core';
import { loadAgentConfig, enrichAgentConfig } from '@dexto/agent-management';
import { Dexto, deriveDisplayName } from '@dexto/agent-management';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
    createDextoApp,
    createNodeServer,
    createMcpTransport as createServerMcpTransport,
    createMcpHttpHandlers,
    initializeMcpServer as initializeServerMcpServer,
    createManualApprovalHandler,
    WebhookEventSubscriber,
    A2ASseEventSubscriber,
    MessageStreamManager,
    type McpTransportType,
} from '@dexto/server';
import { registerGracefulShutdown } from '../utils/graceful-shutdown.js';

const DEFAULT_AGENT_VERSION = '1.0.0';

function resolvePort(listenPort?: number): number {
    if (typeof listenPort === 'number') {
        return listenPort;
    }
    const envPort = Number(process.env.PORT);
    return Number.isFinite(envPort) && envPort > 0 ? envPort : 3000;
}

function resolveBaseUrl(port: number): string {
    return process.env.DEXTO_BASE_URL ?? `http://localhost:${port}`;
}

export type HonoInitializationResult = {
    app: ReturnType<typeof createDextoApp>;
    server: ReturnType<typeof createNodeServer>['server'];
    webhookSubscriber?: NonNullable<ReturnType<typeof createNodeServer>['webhookSubscriber']>;
    agentCard: AgentCard;
    mcpTransport?: Transport;
    switchAgentById: (agentId: string) => Promise<{ id: string; name: string }>;
    switchAgentByPath: (filePath: string) => Promise<{ id: string; name: string }>;
    resolveAgentInfo: (agentId: string) => Promise<{ id: string; name: string }>;
    ensureAgentAvailable: () => void;
    getActiveAgentId: () => string | undefined;
};

//TODO (migration): consider moving this to the server package
export async function initializeHonoApi(
    agent: DextoAgent,
    agentCardOverride?: Partial<AgentCard>,
    listenPort?: number,
    agentId?: string
): Promise<HonoInitializationResult> {
    // Declare before registering shutdown hook to avoid TDZ on signals
    let activeAgent: DextoAgent = agent;
    let activeAgentId: string | undefined = agentId || 'default-agent';
    let isSwitchingAgent = false;
    registerGracefulShutdown(() => activeAgent);

    const resolvedPort = resolvePort(listenPort);
    const baseApiUrl = resolveBaseUrl(resolvedPort);

    // Apply agentCard overrides (if any)
    const overrides = agentCardOverride ?? {};
    let agentCardData = createAgentCard(
        {
            defaultName: overrides.name ?? activeAgentId,
            defaultVersion: overrides.version ?? DEFAULT_AGENT_VERSION,
            defaultBaseUrl: baseApiUrl,
            // webSubscriber: true, // Removed in SSE migration
        },
        overrides
    );

    // Create event subscribers (shared across agent switches)
    const webhookSubscriber = new WebhookEventSubscriber();
    const sseSubscriber = new A2ASseEventSubscriber();
    const messageStreamManager = new MessageStreamManager();

    /**
     * Wire services (SSE subscribers, approval handler) to an agent.
     * Called before agent.start() for both initial setup and agent switching.
     */
    async function wireServicesToAgent(agent: DextoAgent): Promise<void> {
        logger.debug('Wiring services to agent...');

        // Subscribe to event bus (methods handle aborting previous subscriptions)
        webhookSubscriber.subscribe(agent.agentEventBus);
        sseSubscriber.subscribe(agent.agentEventBus);
        messageStreamManager.subscribeToEventBus(agent.agentEventBus);

        // Set approval handler if manual mode
        const config = agent.getEffectiveConfig();
        if (config.toolConfirmation?.mode === 'manual') {
            logger.debug('Setting up manual approval handler...');
            const timeoutMs = config.toolConfirmation?.timeout ?? 120_000;
            const handler = createManualApprovalHandler(agent.agentEventBus, timeoutMs);
            agent.setApprovalHandler(handler);
        }
    }

    /**
     * Helper to resolve agent ID to { id, name } by looking up in registry
     */
    async function resolveAgentInfo(agentId: string): Promise<{ id: string; name: string }> {
        const agents = await Dexto.listAgents();
        const agent =
            agents.installed.find((a) => a.id === agentId) ??
            agents.available.find((a) => a.id === agentId);
        return {
            id: agentId,
            name: agent?.name ?? deriveDisplayName(agentId),
        };
    }

    function ensureAgentAvailable(): void {
        // Gate requests during agent switching
        if (isSwitchingAgent) {
            throw AgentError.switchInProgress();
        }

        // Fast path: most common case is agent is started and running
        if (activeAgent.isStarted() && !activeAgent.isStopped()) {
            return;
        }

        // Provide specific error messages for better debugging
        if (activeAgent.isStopped()) {
            throw AgentError.stopped();
        }
        if (!activeAgent.isStarted()) {
            throw AgentError.notStarted();
        }
    }

    /**
     * Common agent switching logic shared by switchAgentById and switchAgentByPath.
     */
    async function performAgentSwitch(
        newAgent: DextoAgent,
        agentId: string,
        bridge: ReturnType<typeof createNodeServer>
    ) {
        logger.info('Preparing new agent for switch...');

        // Register webhook subscriber for LLM streaming events
        if (bridge.webhookSubscriber) {
            newAgent.registerSubscriber(bridge.webhookSubscriber);
        }

        // Switch activeAgent reference first
        const previousAgent = activeAgent;
        activeAgent = newAgent;
        activeAgentId = agentId;

        // Wire SSE subscribers and approval handler BEFORE starting
        // This is critical - validation in start() requires handler if manual mode
        logger.info('Wiring services to new agent...');
        await wireServicesToAgent(newAgent);

        logger.info(`Starting new agent: ${agentId}`);
        await newAgent.start();

        // Update agent card for A2A and MCP routes
        agentCardData = createAgentCard(
            {
                defaultName: agentId,
                defaultVersion: overrides.version ?? DEFAULT_AGENT_VERSION,
                defaultBaseUrl: baseApiUrl,
                // webSubscriber removed in SSE migration
            },
            overrides
        );

        logger.info(`Successfully switched to agent: ${agentId}`);

        // Now safely stop the previous agent
        try {
            if (previousAgent && previousAgent !== newAgent) {
                logger.info('Stopping previous agent...');
                await previousAgent.stop();
            }
        } catch (err) {
            logger.warn(`Stopping previous agent failed: ${err}`);
            // Don't throw here as the switch was successful
        }

        return await resolveAgentInfo(agentId);
    }

    async function switchAgentById(agentId: string, bridge: ReturnType<typeof createNodeServer>) {
        if (isSwitchingAgent) {
            throw AgentError.switchInProgress();
        }
        isSwitchingAgent = true;

        let newAgent: DextoAgent | undefined;
        try {
            // 1. SHUTDOWN OLD TELEMETRY FIRST (before creating new agent)
            logger.info('Shutting down telemetry for agent switch...');
            const { Telemetry } = await import('@dexto/core');
            await Telemetry.shutdownGlobal();

            // 2. Create new agent from registry (will initialize fresh telemetry in createAgentServices)
            newAgent = await Dexto.createAgent(agentId);

            // 3. Use common switch logic (register subscribers, start agent, stop previous)
            return await performAgentSwitch(newAgent, agentId, bridge);
        } catch (error) {
            logger.error(
                `Failed to switch to agent '${agentId}': ${
                    error instanceof Error ? error.message : String(error)
                }`,
                { error }
            );

            // Clean up the failed new agent if it was created
            if (newAgent) {
                try {
                    await newAgent.stop();
                } catch (cleanupErr) {
                    logger.warn(`Failed to cleanup new agent: ${cleanupErr}`);
                }
            }

            throw error;
        } finally {
            isSwitchingAgent = false;
        }
    }

    async function switchAgentByPath(
        filePath: string,
        bridge: ReturnType<typeof createNodeServer>
    ) {
        if (isSwitchingAgent) {
            throw AgentError.switchInProgress();
        }
        isSwitchingAgent = true;

        let newAgent: DextoAgent | undefined;
        try {
            // 1. SHUTDOWN OLD TELEMETRY FIRST (before creating new agent)
            logger.info('Shutting down telemetry for agent switch...');
            const { Telemetry } = await import('@dexto/core');
            await Telemetry.shutdownGlobal();

            // 2. Load agent configuration from file path
            const config = await loadAgentConfig(filePath);

            // 3. Enrich config with per-agent paths (logs, storage, etc.)
            const enrichedConfig = enrichAgentConfig(config, filePath);

            // 4. Create new agent instance directly (will initialize fresh telemetry in createAgentServices)
            newAgent = new DextoAgent(enrichedConfig, filePath);

            // 5. Use enriched agentId (derived from config or filename during enrichment)
            // enrichAgentConfig always sets agentId, so it's safe to assert non-null
            const agentId = enrichedConfig.agentId!;

            // 6. Use common switch logic (register subscribers, start agent, stop previous)
            return await performAgentSwitch(newAgent, agentId, bridge);
        } catch (error) {
            logger.error(
                `Failed to switch to agent from path '${filePath}': ${
                    error instanceof Error ? error.message : String(error)
                }`,
                { error }
            );

            // Clean up the failed new agent if it was created
            if (newAgent) {
                try {
                    await newAgent.stop();
                } catch (cleanupErr) {
                    logger.warn(`Failed to cleanup new agent: ${cleanupErr}`);
                }
            }

            throw error;
        } finally {
            isSwitchingAgent = false;
        }
    }

    // Getter functions for routes (always use current agent)
    // getAgent automatically ensures agent is available before returning it
    const getAgent = (): DextoAgent => {
        // CRITICAL: Check agent availability before every access to prevent race conditions
        // during agent switching, stopping, or startup failures
        ensureAgentAvailable();
        return activeAgent;
    };
    const getAgentCard = () => agentCardData;

    // Declare bridge variable that will be set later
    let bridgeRef: ReturnType<typeof createNodeServer> | null = null;

    // Create app with agentsContext using closure
    const app = createDextoApp({
        apiPrefix: '/api',
        getAgent,
        getAgentCard,
        messageStreamManager,
        webhookSubscriber,
        sseSubscriber,
        agentsContext: {
            switchAgentById: (id: string) => {
                if (!bridgeRef) throw new Error('Bridge not initialized');
                return switchAgentById(id, bridgeRef);
            },
            switchAgentByPath: (filePath: string) => {
                if (!bridgeRef) throw new Error('Bridge not initialized');
                return switchAgentByPath(filePath, bridgeRef);
            },
            resolveAgentInfo,
            ensureAgentAvailable,
            getActiveAgentId: () => activeAgentId,
        },
    });

    let mcpTransport: Transport | undefined;
    const transportType = (process.env.DEXTO_MCP_TRANSPORT_TYPE as McpTransportType) || 'http';
    try {
        mcpTransport = await createServerMcpTransport(transportType);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to create MCP transport: ${errorMessage}`);
        mcpTransport = undefined;
    }

    // Create bridge with app
    bridgeRef = createNodeServer(app, {
        getAgent,
        mcpHandlers: mcpTransport ? createMcpHttpHandlers(mcpTransport) : null,
    });

    // Register webhook subscriber for LLM streaming events
    logger.info('Registering webhook subscriber with agent...');
    if (bridgeRef.webhookSubscriber) {
        activeAgent.registerSubscriber(bridgeRef.webhookSubscriber);
    }

    // Update agent card
    agentCardData = createAgentCard(
        {
            defaultName: overrides.name ?? activeAgentId,
            defaultVersion: overrides.version ?? DEFAULT_AGENT_VERSION,
            defaultBaseUrl: baseApiUrl,
            // webSubscriber removed in SSE migration
        },
        overrides
    );

    // Wire services to initial agent before starting
    if (!activeAgent.isStarted() && !activeAgent.isStopped()) {
        logger.info('Wiring services to initial agent...');
        await wireServicesToAgent(activeAgent);

        logger.info('Starting initial agent...');
        await activeAgent.start();
    } else if (activeAgent.isStopped()) {
        logger.warn('Initial agent is stopped, this may cause issues');
    }

    // Initialize MCP server after agent has started
    if (mcpTransport) {
        try {
            await initializeServerMcpServer(activeAgent, getAgentCard(), mcpTransport);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to initialize MCP server: ${errorMessage}`);
            mcpTransport = undefined;
        }
    }

    return {
        app,
        server: bridgeRef.server,
        ...(bridgeRef.webhookSubscriber ? { webhookSubscriber: bridgeRef.webhookSubscriber } : {}),
        agentCard: agentCardData,
        ...(mcpTransport ? { mcpTransport } : {}),
        // Expose switching functions for agent routes
        switchAgentById: (id: string) => switchAgentById(id, bridgeRef!),
        switchAgentByPath: (filePath: string) => switchAgentByPath(filePath, bridgeRef!),
        resolveAgentInfo,
        ensureAgentAvailable,
        getActiveAgentId: () => activeAgentId,
    };
}

export async function startHonoApiServer(
    agent: DextoAgent,
    port = 3000,
    agentCardOverride?: Partial<AgentCard>,
    agentId?: string
): Promise<{
    server: ReturnType<typeof createNodeServer>['server'];
    webhookSubscriber?: NonNullable<ReturnType<typeof createNodeServer>['webhookSubscriber']>;
}> {
    const { server, webhookSubscriber } = await initializeHonoApi(
        agent,
        agentCardOverride,
        port,
        agentId
    );

    server.listen(port, '0.0.0.0', () => {
        const networkInterfaces = os.networkInterfaces();
        let localIp = 'localhost';
        Object.values(networkInterfaces).forEach((ifaceList) => {
            ifaceList?.forEach((iface) => {
                if (iface.family === 'IPv4' && !iface.internal) {
                    localIp = iface.address;
                }
            });
        });

        logger.info(
            `Hono server started successfully. Accessible at: http://localhost:${port} and http://${localIp}:${port} on your local network.`,
            null,
            'green'
        );
    });

    return {
        server,
        ...(webhookSubscriber ? { webhookSubscriber } : {}),
    };
}
