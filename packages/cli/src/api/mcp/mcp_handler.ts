import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { AgentCard } from '@dexto/core';
import { logger } from '@dexto/core';
import { z } from 'zod';
import { DextoAgent } from '@dexto/core';
import { randomUUID } from 'crypto';

export type McpTransportType = 'stdio' | 'sse' | 'http';

export async function createMcpTransport(
    transportType: McpTransportType = 'http'
): Promise<Transport> {
    logger.info(`Creating MCP transport of type: ${transportType}`);

    switch (transportType) {
        case 'stdio':
            // Create stdio transport for process communication
            return new StdioServerTransport();

        case 'sse':
            // SSE transport requires an HTTP response object, but we'll create a placeholder
            // This would typically be created when handling an actual SSE request
            throw new Error(
                'SSE transport requires HTTP response context and should be created per-request'
            );

        default: // http
            // Create streamable HTTP transport for HTTP-based communication
            return new StreamableHTTPServerTransport({
                sessionIdGenerator: randomUUID,
                enableJsonResponse: true,
            }) as Transport;
    }
}

/** Initializes MCP server, its tools, resources, and connects to the transport */
export async function initializeMcpServer(
    getAgent: () => DextoAgent,
    getAgentCard: () => AgentCard,
    mcpTransport: Transport
): Promise<McpServer> {
    const agentCardData = getAgentCard();
    const mcpServer = new McpServer(
        { name: agentCardData.name, version: agentCardData.version },
        {
            capabilities: {
                resources: {}, // Declare resource capability
            },
        }
    );

    // Register the primary 'chat' tool with fixed details
    const toolName = 'chat_with_agent'; // Simplified tool name
    const toolDescription = 'Allows you to chat with the an AI agent. Send a message to interact.';

    mcpServer.tool(
        toolName,
        toolDescription,
        { message: z.string() }, // Input schema for the tool
        async ({ message }: { message: string }) => {
            const agent = getAgent();
            logger.info(
                `MCP tool '${toolName}' received message: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`
            );
            const text = await agent.run(message);
            logger.info(
                `MCP tool '${toolName}' sending response: ${text?.substring(0, 100)}${(text?.length ?? 0) > 100 ? '...' : ''}`
            );
            return { content: [{ type: 'text', text: text ?? '' }] }; // Output structure
        }
    );
    logger.info(
        `Registered MCP tool: '${toolName}' with description: "${toolDescription.substring(0, 70)}..."`
    );

    // Register Agent Card data as an MCP Resource
    await initializeAgentCardResource(mcpServer, getAgentCard);

    // Connect server to transport AFTER all registrations
    logger.info(`Initializing MCP protocol server connection...`);
    await mcpServer.connect(mcpTransport);
    logger.info(`✅ MCP server protocol connected via transport.`);
    return mcpServer;
}

/**
 * Initializes the Agent Card resource for the MCP server.
 * @param mcpServer - The MCP server instance.
 * @param getAgentCard - Getter function that returns the current agent card.
 */
export async function initializeAgentCardResource(
    mcpServer: McpServer,
    getAgentCard: () => AgentCard
): Promise<void> {
    const agentCardResourceProgrammaticName = 'agentCard';
    const agentCardResourceUri = 'dexto://agent/card';
    try {
        const readCallback: ReadResourceCallback = async (uri, _extra) => {
            const agentCardData = getAgentCard();
            logger.info(`MCP client requesting resource at ${uri.href}`);
            return {
                contents: [
                    {
                        uri: uri.href,
                        type: 'application/json',
                        text: JSON.stringify(agentCardData, null, 2),
                    },
                ],
            };
        };
        mcpServer.resource(agentCardResourceProgrammaticName, agentCardResourceUri, readCallback);
        logger.info(
            `Registered MCP Resource: '${agentCardResourceProgrammaticName}' at URI '${agentCardResourceUri}'`
        );
    } catch (e: any) {
        logger.warn(
            `Error attempting to register MCP Resource '${agentCardResourceProgrammaticName}': ${e.message}. Check SDK.`
        );
    }
}
