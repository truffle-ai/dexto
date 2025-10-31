import os from 'node:os';
import type { AgentCard } from '@dexto/core';
import {
    createAgentCard,
    logger,
    AgentError,
    Dexto,
    loadAgentConfig,
    deriveDisplayName,
    DextoAgent,
} from '@dexto/core';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
    createDextoApp,
    createNodeServer,
    createMcpTransport as createServerMcpTransport,
    createMcpHttpHandlers,
    initializeMcpServer as initializeServerMcpServer,
    type McpTransportType,
} from '@dexto/server';
import { registerGracefulShutdown } from '../utils/graceful-shutdown.js';
import path from 'path';

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
    websocketServer: ReturnType<typeof createNodeServer>['websocketServer'];
    webSubscriber: ReturnType<typeof createNodeServer>['webSubscriber'];
    webhookSubscriber?: NonNullable<ReturnType<typeof createNodeServer>['webhookSubscriber']>;
    agentCard: AgentCard;
    mcpTransport?: Transport;
    switchAgentById: (agentId: string) => Promise<{ id: string; name: string }>;
    switchAgentByPath: (filePath: string) => Promise<{ id: string; name: string }>;
    resolveAgentInfo: (agentId: string) => Promise<{ id: string; name: string }>;
    ensureAgentAvailable: () => void;
    getActiveAgentId: () => string | undefined;
};

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
            webSubscriber: true, // Will be updated after bridge creation
        },
        overrides
    );

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
        // Register event subscribers with new agent before starting
        logger.info('Registering event subscribers with new agent...');
        newAgent.registerSubscriber(bridge.webSubscriber);
        if (bridge.webhookSubscriber) {
            newAgent.registerSubscriber(bridge.webhookSubscriber);
        }

        logger.info(`Starting new agent: ${agentId}`);
        await newAgent.start();

        // Stop previous agent last (only after new one is fully operational)
        const previousAgent = activeAgent;
        activeAgent = newAgent;
        activeAgentId = agentId;

        // Update agent card for A2A and MCP routes
        agentCardData = createAgentCard(
            {
                defaultName: agentId,
                defaultVersion: overrides.version ?? DEFAULT_AGENT_VERSION,
                defaultBaseUrl: baseApiUrl,
                webSubscriber: bridge.webSubscriber,
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

            // 3. Create new agent instance directly (will initialize fresh telemetry in createAgentServices)
            newAgent = new DextoAgent(config, filePath);

            // 4. Derive agent ID from config or filename
            const agentId =
                config.agentCard?.name || path.basename(filePath, path.extname(filePath));

            // 5. Use common switch logic (register subscribers, start agent, stop previous)
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

    // Create bridge with app - bridge will create webSubscriber
    bridgeRef = createNodeServer(app, {
        agent: getAgent(),
        getAgent,
        mcpHandlers: mcpTransport ? createMcpHttpHandlers(mcpTransport) : null,
    });

    // Register subscribers with initial agent
    logger.info('Registering event subscribers with agent...');
    activeAgent.registerSubscriber(bridgeRef.webSubscriber);
    if (bridgeRef.webhookSubscriber) {
        activeAgent.registerSubscriber(bridgeRef.webhookSubscriber);
    }

    // Update agent card with actual webSubscriber
    agentCardData = createAgentCard(
        {
            defaultName: overrides.name ?? activeAgentId,
            defaultVersion: overrides.version ?? DEFAULT_AGENT_VERSION,
            defaultBaseUrl: baseApiUrl,
            webSubscriber: bridgeRef.webSubscriber,
        },
        overrides
    );

    // Ensure the initial agent is started
    if (!activeAgent.isStarted() && !activeAgent.isStopped()) {
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
        websocketServer: bridgeRef.websocketServer,
        webSubscriber: bridgeRef.webSubscriber,
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
    wss: ReturnType<typeof createNodeServer>['websocketServer'];
    webSubscriber: ReturnType<typeof createNodeServer>['webSubscriber'];
    webhookSubscriber?: NonNullable<ReturnType<typeof createNodeServer>['webhookSubscriber']>;
}> {
    const { server, websocketServer, webSubscriber, webhookSubscriber } = await initializeHonoApi(
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
        wss: websocketServer,
        webSubscriber,
        ...(webhookSubscriber ? { webhookSubscriber } : {}),
    };
}
