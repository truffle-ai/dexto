import os from 'node:os';
import type { Context } from 'hono';
import type { AgentCard } from '@dexto/core';
import { DextoAgent, createAgentCard, logger, AgentError } from '@dexto/core';
import {
    loadAgentConfig,
    deriveDisplayName,
    getAgentRegistry,
    AgentFactory,
    globalPreferencesExist,
    loadGlobalPreferences,
    createDextoAgentFromConfig,
} from '@dexto/agent-management';
import { applyUserPreferences } from '../config/cli-overrides.js';
import { createFileSessionLoggerFactory } from '../utils/session-logger-factory.js';
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
    ApprovalCoordinator,
    type McpTransportType,
    type WebUIRuntimeConfig,
} from '@dexto/server';
import { registerGracefulShutdown } from '../utils/graceful-shutdown.js';

const DEFAULT_AGENT_VERSION = '1.0.0';

const sessionLoggerFactory = createFileSessionLoggerFactory();

/**
 * List all agents (installed and available)
 * Replacement for old Dexto.listAgents()
 */
async function listAgents(): Promise<{
    installed: Array<{
        id: string;
        name: string;
        description: string;
        author?: string;
        tags?: string[];
        type: 'builtin' | 'custom';
    }>;
    available: Array<{
        id: string;
        name: string;
        description: string;
        author?: string;
        tags?: string[];
        type: 'builtin' | 'custom';
    }>;
}> {
    return AgentFactory.listAgents({
        descriptionFallback: 'No description',
        customAgentDescriptionFallback: 'Custom agent',
    });
}

/**
 * Create an agent from an agent ID
 * Replacement for old Dexto.createAgent()
 * Uses registry.resolveAgent() which auto-installs if needed
 *
 * Applies user preferences (preferences.yml) to ALL agents, not just the default.
 * See feature-plans/auto-update.md section 8.11 - Three-Layer LLM Resolution.
 */
async function createAgentFromId(agentId: string): Promise<DextoAgent> {
    try {
        // Use registry to resolve agent path (auto-installs if not present)
        const registry = getAgentRegistry();
        const agentPath = await registry.resolveAgent(agentId, true);

        // Load agent config
        let config = await loadAgentConfig(agentPath);

        // Apply user's LLM preferences to ALL agents
        // Three-Layer Resolution: local.llm ?? preferences.llm ?? bundled.llm
        if (globalPreferencesExist()) {
            try {
                const preferences = await loadGlobalPreferences();
                if (preferences?.llm?.provider && preferences?.llm?.model) {
                    config = applyUserPreferences(config, preferences);
                    logger.debug(`Applied user preferences to ${agentId}`, {
                        provider: preferences.llm.provider,
                        model: preferences.llm.model,
                    });
                }
            } catch {
                logger.debug('Could not load preferences, using bundled config');
            }
        }

        logger.info(`Creating agent: ${agentId} from ${agentPath}`);
        return await createDextoAgentFromConfig({
            config,
            configPath: agentPath,
            enrichOptions: { logLevel: 'info' },
            overrides: { sessionLoggerFactory },
        });
    } catch (error) {
        throw new Error(
            `Failed to create agent '${agentId}': ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

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
    agentId?: string,
    configFilePath?: string,
    webRoot?: string,
    webUIConfig?: WebUIRuntimeConfig
): Promise<HonoInitializationResult> {
    // Declare before registering shutdown hook to avoid TDZ on signals
    let activeAgent: DextoAgent = agent;
    let activeAgentId: string | undefined = agentId || 'coding-agent';
    let activeAgentConfigPath: string | undefined = configFilePath;
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
        },
        overrides
    );

    // Create event subscribers and approval coordinator (shared across agent switches)
    const webhookSubscriber = new WebhookEventSubscriber();
    const sseSubscriber = new A2ASseEventSubscriber();
    const approvalCoordinator = new ApprovalCoordinator();

    /**
     * Wire services (SSE subscribers) to an agent.
     * Called for agent switching to re-subscribe to the new agent's event bus.
     * Note: Approval handler and coordinator are set before agent.start() for each agent.
     */
    async function wireServicesToAgent(agent: DextoAgent): Promise<void> {
        logger.debug('Wiring services to agent...');

        // Register subscribers (DextoAgent handles (re-)subscription on start/restart)
        agent.registerSubscriber(webhookSubscriber);
        agent.registerSubscriber(sseSubscriber);
        // Note: ApprovalCoordinator doesn't subscribe to agent event bus
        // It's a separate coordination channel between handler and server
    }

    /**
     * Helper to resolve agent ID to { id, name } by looking up in registry
     */
    async function resolveAgentInfo(agentId: string): Promise<{ id: string; name: string }> {
        const agents = await listAgents();
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
        agentConfigPath: string | undefined,
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
        activeAgentConfigPath = agentConfigPath;

        // Set approval handler if manual mode OR elicitation enabled (before start() for validation)
        const needsHandler =
            newAgent.config.permissions.mode === 'manual' || newAgent.config.elicitation.enabled;

        if (needsHandler) {
            logger.debug('Setting up manual approval handler for new agent...');
            const handler = createManualApprovalHandler(approvalCoordinator);
            newAgent.setApprovalHandler(handler);
        }

        // Wire SSE subscribers BEFORE starting
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
        let newAgentConfigPath: string | undefined;
        try {
            // 1. SHUTDOWN OLD TELEMETRY FIRST (before creating new agent)
            logger.info('Shutting down telemetry for agent switch...');
            const { Telemetry } = await import('@dexto/core');
            await Telemetry.shutdownGlobal();

            // 2. Create new agent from registry (will initialize fresh telemetry in createAgentServices)
            const registry = getAgentRegistry();
            newAgentConfigPath = await registry.resolveAgent(agentId, true);
            newAgent = await createAgentFromId(agentId);

            // 3. Use common switch logic (register subscribers, start agent, stop previous)
            return await performAgentSwitch(newAgent, agentId, newAgentConfigPath, bridge);
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
            let config = await loadAgentConfig(filePath);

            // 2.5. Apply user's LLM preferences to ALL agents
            // Three-Layer Resolution: local.llm ?? preferences.llm ?? bundled.llm
            if (globalPreferencesExist()) {
                try {
                    const preferences = await loadGlobalPreferences();
                    if (preferences?.llm?.provider && preferences?.llm?.model) {
                        config = applyUserPreferences(config, preferences);
                        logger.debug(
                            `Applied user preferences to agent from ${filePath} (provider=${preferences.llm.provider}, model=${preferences.llm.model})`
                        );
                    }
                } catch {
                    logger.debug('Could not load preferences, using bundled config');
                }
            }

            // 3. Create new agent instance (will initialize fresh telemetry in createAgentServices)
            newAgent = await createDextoAgentFromConfig({
                config,
                configPath: filePath,
                enrichOptions: { logLevel: 'info' },
                overrides: { sessionLoggerFactory },
            });

            // 4. Use enriched agentId (derived from config or filename during enrichment)
            const agentId = newAgent.config.agentId;

            // 5. Use common switch logic (register subscribers, start agent, stop previous)
            return await performAgentSwitch(newAgent, agentId, filePath, bridge);
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
    // Accepts Context parameter for compatibility with GetAgentFn type
    const getAgent = (_ctx: Context): DextoAgent => {
        // CRITICAL: Check agent availability before every access to prevent race conditions
        // during agent switching, stopping, or startup failures
        ensureAgentAvailable();
        return activeAgent;
    };
    const getAgentCard = () => agentCardData;
    const getAgentConfigPath = (_ctx: Context): string | undefined => activeAgentConfigPath;

    // Declare bridge variable that will be set later
    let bridgeRef: ReturnType<typeof createNodeServer> | null = null;

    // Create app with agentsContext using closure
    const app = createDextoApp({
        apiPrefix: '/api',
        getAgent,
        getAgentConfigPath,
        getAgentCard,
        approvalCoordinator,
        webhookSubscriber,
        sseSubscriber,
        ...(webRoot ? { webRoot } : {}),
        ...(webUIConfig ? { webUIConfig } : {}),
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
        getAgent: () => activeAgent,
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
        },
        overrides
    );

    // Set approval handler for initial agent if manual mode OR elicitation enabled (before start() for validation)
    const needsHandler =
        activeAgent.config.permissions.mode === 'manual' || activeAgent.config.elicitation.enabled;

    if (needsHandler) {
        logger.debug('Setting up manual approval handler for initial agent...');
        const handler = createManualApprovalHandler(approvalCoordinator);
        activeAgent.setApprovalHandler(handler);
    }

    // Wire SSE subscribers to initial agent
    logger.info('Wiring SSE subscribers to initial agent...');
    await wireServicesToAgent(activeAgent);

    // Start the initial agent now that approval handler is set and subscribers are wired
    logger.info('Starting initial agent...');
    await activeAgent.start();

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
    agentId?: string,
    configFilePath?: string,
    webRoot?: string,
    webUIConfig?: WebUIRuntimeConfig
): Promise<{
    server: ReturnType<typeof createNodeServer>['server'];
    webhookSubscriber?: NonNullable<ReturnType<typeof createNodeServer>['webhookSubscriber']>;
}> {
    const { server, webhookSubscriber } = await initializeHonoApi(
        agent,
        agentCardOverride,
        port,
        agentId,
        configFilePath,
        webRoot,
        webUIConfig
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
