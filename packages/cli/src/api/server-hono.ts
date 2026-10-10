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
    SessionSseEventSubscriber,
    ApprovalCoordinator,
    wireApprovalCoordinatorToAgent,
    type McpTransportType,
    type WebUIRuntimeConfig,
} from '@dexto/server';
import { registerGracefulShutdown } from '../utils/graceful-shutdown.js';
import { applyWorkspaceToAgent } from '../utils/workspace.js';

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
async function createAgentFromId(agentId: string, workspaceRoot?: string): Promise<DextoAgent> {
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
            enrichOptions: {
                logLevel: 'info',
                ...(workspaceRoot ? { workspaceRoot } : {}),
            },
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
    stop: () => Promise<void>;
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
    workspaceRoot?: string,
    webRoot?: string,
    webUIConfig?: WebUIRuntimeConfig
): Promise<HonoInitializationResult> {
    let activeAgent: DextoAgent = agent;
    const ownedAgents = new Set([agent]);
    let activeAgentId: string | undefined = agentId || 'coding-agent';
    let activeAgentConfigPath: string | undefined = configFilePath;

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
    const sessionSseSubscriber = new SessionSseEventSubscriber();
    const approvalCoordinator = new ApprovalCoordinator();
    let approvalEventBridge: AbortController | null = null;
    let bridgeRef: ReturnType<typeof createNodeServer> | null = null;
    let mcpTransport: Transport | undefined;
    let disposeShutdown: (() => void) | undefined;
    let stopPromise: Promise<void> | undefined;
    let pendingAgentSwitch: Promise<{ id: string; name: string }> | undefined;

    function runAgentSwitch(operation: () => Promise<{ id: string; name: string }>) {
        if (stopPromise) return Promise.reject(AgentError.stopped());
        if (pendingAgentSwitch) return Promise.reject(AgentError.switchInProgress());
        pendingAgentSwitch = operation();
        return pendingAgentSwitch.finally(() => {
            pendingAgentSwitch = undefined;
        });
    }

    function stop(): Promise<void> {
        if (!stopPromise) {
            stopPromise = (async () => {
                await pendingAgentSwitch?.catch(() => undefined);
                const results = await Promise.allSettled([
                    Promise.resolve().then(() => disposeShutdown?.()),
                    Promise.resolve().then(() => approvalEventBridge?.abort()),
                    Promise.resolve().then(() => sseSubscriber.cleanup()),
                    Promise.resolve().then(() => sessionSseSubscriber.cleanup()),
                    Promise.resolve().then(() => {
                        if (!bridgeRef) {
                            webhookSubscriber.cleanup();
                            return;
                        }
                        const server = bridgeRef.server;
                        return new Promise<void>((resolve, reject) => {
                            server.close((error) => {
                                if (
                                    error &&
                                    (!('code' in error) || error.code !== 'ERR_SERVER_NOT_RUNNING')
                                )
                                    reject(error);
                                else resolve();
                            });
                            server.closeAllConnections();
                        });
                    }),
                    Promise.resolve().then(() => mcpTransport?.close()),
                    ...Array.from(ownedAgents, (ownedAgent) =>
                        Promise.resolve().then(() => ownedAgent.stop())
                    ),
                ]);
                const failures = results
                    .filter((result) => result.status === 'rejected')
                    .map((result) => result.reason);
                if (failures.length)
                    throw new AggregateError(failures, 'Failed to stop CLI HTTP host');
            })();
        }
        return stopPromise;
    }

    try {
        /**
         * Wire services (SSE subscribers) to an agent.
         * Called for agent switching to re-subscribe to the new agent's event bus.
         * Note: Approval handler and coordinator are set before agent.start() for each agent.
         */
        async function wireServicesToAgent(agent: DextoAgent): Promise<void> {
            logger.debug('Wiring services to agent...');

            approvalEventBridge?.abort();
            approvalEventBridge = wireApprovalCoordinatorToAgent(agent, approvalCoordinator);

            // Register subscribers (DextoAgent handles (re-)subscription on start/restart)
            agent.registerSubscriber(webhookSubscriber);
            agent.registerSubscriber(sseSubscriber);
            agent.registerSubscriber(sessionSseSubscriber);
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
            if (stopPromise) throw AgentError.stopped();

            // Gate requests during agent switching
            if (pendingAgentSwitch) {
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
            ownedAgents.add(newAgent);
            logger.info('Preparing new agent for switch...');

            const previousAgent = activeAgent;
            try {
                // Register webhook subscriber for LLM streaming events
                if (bridge.webhookSubscriber) {
                    newAgent.registerSubscriber(bridge.webhookSubscriber);
                }

                // Set approval handler if manual mode OR elicitation enabled (before start() for validation)
                const needsHandler =
                    newAgent.config.permissions.mode === 'manual' ||
                    newAgent.config.elicitation.enabled;

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
                if (workspaceRoot) {
                    await applyWorkspaceToAgent(newAgent, workspaceRoot);
                }

                const agentInfo = await resolveAgentInfo(agentId);
                const nextAgentCard = createAgentCard(
                    {
                        defaultName: agentId,
                        defaultVersion: overrides.version ?? DEFAULT_AGENT_VERSION,
                        defaultBaseUrl: baseApiUrl,
                    },
                    overrides
                );

                // Publish only after the replacement is ready; failed preparation leaves routes intact.
                activeAgent = newAgent;
                activeAgentId = agentId;
                activeAgentConfigPath = agentConfigPath;
                agentCardData = nextAgentCard;
                logger.info(`Successfully switched to agent: ${agentId}`);

                // Now safely stop the previous agent
                try {
                    if (previousAgent && previousAgent !== newAgent) {
                        logger.info('Stopping previous agent...');
                        await previousAgent.stop();
                        ownedAgents.delete(previousAgent);
                    }
                } catch (err) {
                    logger.warn(`Stopping previous agent failed: ${err}`);
                    // Don't throw here as the switch was successful
                }

                return agentInfo;
            } catch (error) {
                // Subscribers are shared and may already have moved to the replacement's event bus.
                try {
                    if (bridge.webhookSubscriber)
                        previousAgent.registerSubscriber(bridge.webhookSubscriber);
                    await wireServicesToAgent(previousAgent);
                } catch (recoveryError) {
                    logger.error('Failed to restore services to previous agent', {
                        error: recoveryError,
                    });
                }
                throw error;
            }
        }

        async function switchAgentById(
            agentId: string,
            bridge: ReturnType<typeof createNodeServer>
        ) {
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
                newAgent = await createAgentFromId(agentId, workspaceRoot);

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
                        ownedAgents.delete(newAgent);
                    } catch (cleanupErr) {
                        logger.warn(`Failed to cleanup new agent: ${cleanupErr}`);
                    }
                }

                throw error;
            }
        }

        async function switchAgentByPath(
            filePath: string,
            bridge: ReturnType<typeof createNodeServer>
        ) {
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
                    enrichOptions: {
                        logLevel: 'info',
                        ...(workspaceRoot ? { workspaceRoot } : {}),
                    },
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
                        ownedAgents.delete(newAgent);
                    } catch (cleanupErr) {
                        logger.warn(`Failed to cleanup new agent: ${cleanupErr}`);
                    }
                }

                throw error;
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
        const getAgentConfigPath = (_ctx: Context): string | undefined => activeAgentConfigPath;

        // Create app with agentsContext using closure
        const app = createDextoApp({
            apiPrefix: '/api',
            getAgent,
            getAgentConfigPath,
            getAgentCard,
            approvalCoordinator,
            webhookSubscriber,
            sseSubscriber,
            sessionSseSubscriber,
            ...(webRoot ? { webRoot } : {}),
            ...(webUIConfig ? { webUIConfig } : {}),
            agentsContext: {
                switchAgentById: (id: string) => {
                    if (!bridgeRef) throw new Error('Bridge not initialized');
                    const bridge = bridgeRef;
                    return runAgentSwitch(() => switchAgentById(id, bridge));
                },
                switchAgentByPath: (filePath: string) => {
                    if (!bridgeRef) throw new Error('Bridge not initialized');
                    const bridge = bridgeRef;
                    return runAgentSwitch(() => switchAgentByPath(filePath, bridge));
                },
                resolveAgentInfo,
                ensureAgentAvailable,
                getActiveAgentId: () => activeAgentId,
            },
        });

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
            activeAgent.config.permissions.mode === 'manual' ||
            activeAgent.config.elicitation.enabled;

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
        if (workspaceRoot) {
            await applyWorkspaceToAgent(activeAgent, workspaceRoot);
        }

        // Initialize MCP server after agent has started
        if (mcpTransport) {
            try {
                await initializeServerMcpServer(activeAgent, getAgentCard(), mcpTransport, {
                    getAgent,
                    getAgentCard: () => {
                        ensureAgentAvailable();
                        return getAgentCard();
                    },
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.error(`Failed to initialize MCP server: ${errorMessage}`);
                await mcpTransport.close();
                mcpTransport = undefined;
            }
        }

        disposeShutdown = registerGracefulShutdown(() => ({ stop }));
        const bridge = bridgeRef;

        return {
            stop,
            app,
            server: bridgeRef.server,
            ...(bridgeRef.webhookSubscriber
                ? { webhookSubscriber: bridgeRef.webhookSubscriber }
                : {}),
            agentCard: agentCardData,
            ...(mcpTransport ? { mcpTransport } : {}),
            // Expose switching functions for agent routes
            switchAgentById: (id: string) => runAgentSwitch(() => switchAgentById(id, bridge)),
            switchAgentByPath: (filePath: string) =>
                runAgentSwitch(() => switchAgentByPath(filePath, bridge)),
            resolveAgentInfo,
            ensureAgentAvailable,
            getActiveAgentId: () => activeAgentId,
        };
    } catch (error) {
        try {
            await stop();
        } catch (cleanupError) {
            logger.error('Failed to roll back CLI HTTP host', { error: cleanupError });
        }
        throw error;
    }
}

export async function startHonoApiServer(
    agent: DextoAgent,
    port = 3000,
    agentCardOverride?: Partial<AgentCard>,
    agentId?: string,
    configFilePath?: string,
    workspaceRoot?: string,
    webRoot?: string,
    webUIConfig?: WebUIRuntimeConfig
): Promise<{
    server: ReturnType<typeof createNodeServer>['server'];
    stop: () => Promise<void>;
    webhookSubscriber?: NonNullable<ReturnType<typeof createNodeServer>['webhookSubscriber']>;
}> {
    const { server, webhookSubscriber, stop } = await initializeHonoApi(
        agent,
        agentCardOverride,
        port,
        agentId,
        configFilePath,
        workspaceRoot,
        webRoot,
        webUIConfig
    );

    try {
        await new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => reject(error);
            server.once('error', onError);
            server.listen(port, '0.0.0.0', () => {
                server.off('error', onError);
                resolve();
            });
        });
    } catch (error) {
        try {
            await stop();
        } catch (cleanupError) {
            logger.error('Failed to roll back CLI HTTP listener', { error: cleanupError });
        }
        throw error;
    }
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

    return {
        server,
        stop,
        ...(webhookSubscriber ? { webhookSubscriber } : {}),
    };
}
