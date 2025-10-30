import os from 'node:os';
import type { AgentCard, DextoAgent } from '@dexto/core';
import { createAgentCard, logger } from '@dexto/core';
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

const DEFAULT_AGENT_NAME = 'dexto';
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
};

export async function initializeHonoApi(
    agent: DextoAgent,
    agentCardOverride?: Partial<AgentCard>,
    listenPort?: number
): Promise<HonoInitializationResult> {
    registerGracefulShutdown(() => agent);

    const resolvedPort = resolvePort(listenPort);
    const baseApiUrl = resolveBaseUrl(resolvedPort);

    const agentCard = createAgentCard(
        {
            defaultName: agentCardOverride?.name ?? DEFAULT_AGENT_NAME,
            defaultVersion: agentCardOverride?.version ?? DEFAULT_AGENT_VERSION,
            defaultBaseUrl: baseApiUrl,
            webSubscriber: true,
        },
        agentCardOverride
    );

    const app = createDextoApp(agent, { apiPrefix: '/api', agentCard });

    let mcpTransport: Transport | undefined;
    const transportType = (process.env.DEXTO_MCP_TRANSPORT_TYPE as McpTransportType) || 'http';
    try {
        mcpTransport = await createServerMcpTransport(transportType);
        await initializeServerMcpServer(agent, agentCard, mcpTransport);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to initialize MCP server: ${errorMessage}`);
        mcpTransport = undefined;
    }

    const bridge = createNodeServer(app, {
        agent,
        mcpHandlers: mcpTransport ? createMcpHttpHandlers(mcpTransport) : null,
    });

    return {
        app,
        server: bridge.server,
        websocketServer: bridge.websocketServer,
        webSubscriber: bridge.webSubscriber,
        ...(bridge.webhookSubscriber ? { webhookSubscriber: bridge.webhookSubscriber } : {}),
        agentCard,
        ...(mcpTransport ? { mcpTransport } : {}),
    };
}

export async function startHonoApiServer(
    agent: DextoAgent,
    port = 3000,
    agentCardOverride?: Partial<AgentCard>
): Promise<{
    server: ReturnType<typeof createNodeServer>['server'];
    wss: ReturnType<typeof createNodeServer>['websocketServer'];
    webSubscriber: ReturnType<typeof createNodeServer>['webSubscriber'];
    webhookSubscriber?: NonNullable<ReturnType<typeof createNodeServer>['webhookSubscriber']>;
}> {
    const { server, websocketServer, webSubscriber, webhookSubscriber } = await initializeHonoApi(
        agent,
        agentCardOverride,
        port
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
