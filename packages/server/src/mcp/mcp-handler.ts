import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { AgentCard, Logger } from '@dexto/core';
import { logger } from '@dexto/core';
import { z } from 'zod';
import type { DextoAgent } from '@dexto/core';
import { randomUUID } from 'crypto';

export type McpTransportType = 'stdio' | 'sse' | 'http';

export async function createMcpTransport(
    transportType: McpTransportType = 'http'
): Promise<Transport> {
    logger.info(`Creating MCP transport of type: ${transportType}`);

    switch (transportType) {
        case 'stdio':
            return new StdioServerTransport();
        case 'sse':
            throw new Error(
                'SSE transport requires HTTP response context and should be created per-request'
            );
        default: {
            // Use stateless mode (no session management) for better compatibility
            // with clients like OpenAI that may not properly handle Mcp-Session-Id headers
            return new StreamableHTTPServerTransport({
                enableJsonResponse: true,
            }) as Transport;
        }
    }
}

export interface McpAgentContext {
    getAgent(): DextoAgent;
    getAgentCard(): AgentCard;
}

/** Static callers retain their agent/card; switching hosts can supply live getters. */
export async function initializeMcpServer(
    agent: DextoAgent,
    agentCardData: AgentCard,
    mcpTransport: Transport,
    context: McpAgentContext = { getAgent: () => agent, getAgentCard: () => agentCardData }
): Promise<McpServer> {
    const mcpServer = new McpServer(
        { name: agentCardData.name, version: agentCardData.version },
        {
            capabilities: {
                resources: {},
            },
        }
    );

    const toolName = 'chat_with_agent';
    const toolDescription = 'Allows you to chat with the an AI agent. Send a message to interact.';

    mcpServer.registerTool(
        toolName,
        { description: toolDescription, inputSchema: { message: z.string() } },
        async ({ message }: { message: string }) => {
            // Keep session creation, execution and cleanup on the same agent if the host switches.
            const agent = context.getAgent();
            agent.logger.info(`MCP tool '${toolName}' call started`);
            // Create ephemeral session for this MCP tool call (stateless MCP interactions)
            const session = await agent.createSession(`mcp-${randomUUID()}`);
            try {
                const text = await agent.run(message, undefined, undefined, session.id);
                agent.logger.info(`MCP tool '${toolName}' call completed`);
                return { content: [{ type: 'text', text: text ?? '' }] };
            } finally {
                // Always clean up ephemeral session to prevent accumulation
                await agent
                    .deleteSession(session.id)
                    .catch(() => agent.logger.warn(`Failed to cleanup MCP session ${session.id}`));
            }
        }
    );
    agent.logger.info(`Registered MCP tool: '${toolName}'`);

    await registerAgentCardResource(mcpServer, () => context.getAgentCard(), agent.logger);

    agent.logger.info(`Initializing MCP protocol server connection...`);
    await mcpServer.connect(mcpTransport);
    agent.logger.info(`✅ MCP server protocol connected via transport.`);
    return mcpServer;
}

export function initializeAgentCardResource(
    mcpServer: McpServer,
    agentCardData: AgentCard,
    agentLogger: Logger
): Promise<void> {
    return registerAgentCardResource(mcpServer, () => agentCardData, agentLogger);
}

async function registerAgentCardResource(
    mcpServer: McpServer,
    getAgentCard: () => AgentCard,
    agentLogger: Logger
): Promise<void> {
    const agentCardResourceProgrammaticName = 'agentCard';
    const agentCardResourceUri = 'dexto://agent/card';
    try {
        const readCallback: ReadResourceCallback = async (uri, _extra) => {
            agentLogger.info(`MCP client requesting resource at ${uri.href}`);
            return {
                contents: [
                    {
                        uri: uri.href,
                        type: 'application/json',
                        text: JSON.stringify(getAgentCard(), null, 2),
                    },
                ],
            };
        };
        mcpServer.registerResource(
            agentCardResourceProgrammaticName,
            agentCardResourceUri,
            {},
            readCallback
        );
        agentLogger.info(
            `Registered MCP Resource: '${agentCardResourceProgrammaticName}' at URI '${agentCardResourceUri}'`
        );
    } catch (e: any) {
        agentLogger.warn(
            `Error attempting to register MCP Resource '${agentCardResourceProgrammaticName}': ${e.message}. Check SDK.`
        );
    }
}

export function createMcpHttpHandlers(mcpTransport: Transport) {
    if (!(mcpTransport instanceof StreamableHTTPServerTransport)) {
        logger.info('Non-HTTP transport detected. Skipping HTTP route setup.');
        return null;
    }

    const handleRequest = async (req: IncomingMessage, res: ServerResponse, body?: unknown) => {
        logger.info(`MCP ${req.method} request received`);
        try {
            await mcpTransport.handleRequest(req, res, body);
        } catch {
            logger.error('MCP HTTP request failed');
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal Server Error' }));
            } else if (!res.writableEnded) {
                res.destroy();
            }
        }
    };

    return { handlePost: handleRequest, handleGet: handleRequest, handleDelete: handleRequest };
}
