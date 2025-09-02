import type { Express } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { AgentCard } from '@core/index.js';
import { logger } from '@core/index.js';
import { z } from 'zod';
import express from 'express';
import { DextoAgent } from '@core/index.js';
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
    agent: DextoAgent,
    agentCardData: AgentCard,
    mcpTransport: Transport
): Promise<McpServer> {
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
    await initializeAgentCardResource(mcpServer, agentCardData);

    // Connect server to transport AFTER all registrations
    logger.info(`Initializing MCP protocol server connection...`);
    await mcpServer.connect(mcpTransport);
    logger.info(`✅ MCP server protocol connected via transport.`);
    return mcpServer;
}

/**
 * Initializes the Agent Card resource for the MCP server.
 * @param mcpServer - The MCP server instance.
 * @param agentCardData - The agent card data to be registered as an MCP resource.
 */
export async function initializeAgentCardResource(
    mcpServer: McpServer,
    agentCardData: AgentCard
): Promise<void> {
    const agentCardResourceProgrammaticName = 'agentCard';
    const agentCardResourceUri = 'dexto://agent/card';
    try {
        const readCallback: ReadResourceCallback = async (uri, _extra) => {
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

/**
 * Initializes and sets up the MCP HTTP endpoints.
 */
export async function initializeMcpServerApiEndpoints(
    app: Express,
    mcpTransport: Transport
): Promise<void> {
    // Only set up HTTP routes for StreamableHTTPServerTransport
    if (mcpTransport instanceof StreamableHTTPServerTransport) {
        // Mount /mcp for JSON-RPC and SSE handling
        app.post('/mcp', express.json(), (req, res) => {
            logger.info(`MCP POST /mcp received request body: ${JSON.stringify(req.body)}`);
            mcpTransport
                .handleRequest(req, res, req.body)
                .catch((err) => logger.error(`MCP POST error: ${JSON.stringify(err, null, 2)}`));
        });
        app.get('/mcp', (req, res) => {
            logger.info(`MCP GET /mcp received request, attempting to establish SSE connection.`);
            mcpTransport
                .handleRequest(req, res)
                .catch((err) => logger.error(`MCP GET error: ${JSON.stringify(err, null, 2)}`));
        });
        logger.info('Mounted MCP routes (/mcp for POST and GET).');
    } else {
        logger.info('Non-HTTP transport detected. Skipping HTTP route setup.');
    }
}
