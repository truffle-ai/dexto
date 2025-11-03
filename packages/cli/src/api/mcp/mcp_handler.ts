import type { Express } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { AgentCard } from '@dexto/core';
import { logger } from '@dexto/core';
import { z } from 'zod';
import express from 'express';
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

    // For HTTP transport, connect per request.
    // Connection is handled in initializeMcpServerApiEndpoints.
    if (!(mcpTransport instanceof StreamableHTTPServerTransport)) {
        // For stdio and other persistent transports, connect at startup
        logger.info(`Initializing MCP protocol server connection...`);
        await mcpServer.connect(mcpTransport);
        logger.info(`✅ MCP server protocol connected via transport.`);
    } else {
        logger.info(`MCP server configured for HTTP transport (sessions created per-request)`);
    }
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
    } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.warn(
            `Error attempting to register MCP Resource '${agentCardResourceProgrammaticName}': ${err.message}. Check SDK.`
        );
    }
}

/**
 * Initializes and sets up the MCP HTTP endpoints.
 * @param app - Express application instance
 * @param mcpTransport - MCP transport instance
 * @param mcpServer - MCP server instance (required when using HTTP transport)
 * @throws {Error} If HTTP transport is used but mcpServer is undefined/null
 */
export async function initializeMcpServerApiEndpoints(
    app: Express,
    mcpTransport: Transport,
    mcpServer?: McpServer
): Promise<void> {
    // Only set up HTTP routes for StreamableHTTPServerTransport
    if (mcpTransport instanceof StreamableHTTPServerTransport) {
        // HTTP transport requires a non-null mcpServer
        if (!mcpServer) {
            throw new Error(
                'HTTP transport requires a non-null mcpServer parameter. Please provide an initialized McpServer instance when using HTTP transport.'
            );
        }

        // For HTTP transport, connect the server once to the transport
        // handleRequest() will manage sessions per-request based on Mcp-Session-Id headers
        try {
            await mcpServer.connect(mcpTransport);
            logger.info('MCP server connected to HTTP transport (sessions managed per-request)');
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`Failed to connect MCP server to HTTP transport: ${err.message}`, {
                error: err.stack,
            });
            if (error instanceof Error) {
                throw error;
            }
            throw err;
        }

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
