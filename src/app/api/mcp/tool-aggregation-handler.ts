import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { MCPManager } from '@core/mcp/manager.js';
import { logger } from '@core/index.js';
import { ServerConfigs } from '@core/mcp/schemas.js';
import { NoOpConfirmationProvider } from '@core/tools/confirmation/noop-confirmation-provider.js';
import { jsonSchemaToZodShape } from '@core/utils/index.js';

/**
 * Initializes MCP server for tool aggregation mode.
 * Instead of exposing an AI agent, this directly exposes all tools from connected MCP servers.
 */
export async function initializeMcpToolAggregationServer(
    serverConfigs: ServerConfigs,
    mcpTransport: Transport,
    serverName: string,
    serverVersion: string,
    _strict: boolean
): Promise<McpServer> {
    // Create MCP manager with no confirmation provider (tools are auto-approved)
    const mcpManager = new MCPManager(new NoOpConfirmationProvider());

    // Initialize all MCP server connections from config
    logger.info('Connecting to configured MCP servers for tool aggregation...');
    await mcpManager.initializeFromConfig(serverConfigs);

    // Create the aggregation MCP server
    const mcpServer = new McpServer(
        { name: serverName, version: serverVersion },
        {
            capabilities: {
                tools: {},
                resources: {},
                prompts: {},
            },
        }
    );

    // Get all tools from connected servers and register them
    // TODO: Temporary hacky solution to get the tools from the connected servers, directly using the MCP Client to preserve types
    // TODO: We should use the MCPManager or MCPClient instead of directly interacting with the raw client to get the tools, but we lose type information and it becomes any type which is hard to work with
    const mcpClientsMap = mcpManager.getClients();
    let toolCount = 0;
    for (const [clientName, client] of mcpClientsMap.entries()) {
        // Get the actual MCP Client
        const connectedClient = await client.getConnectedClient();
        // Get the tools from the MCP client
        const mcpTools = await connectedClient.listTools({});

        logger.debug(`MCP client name: ${clientName}`);
        logger.debug(`MCP client tools: ${JSON.stringify(mcpTools, null, 2)}`);

        // TODO: Handle tool name/server name/prompt name collisions properly
        for (const tool of mcpTools.tools) {
            toolCount++;
            logger.debug(`Registering tool: ${tool.name}`);

            // Convert JSON Schema to Zod raw shape
            const zodShape = jsonSchemaToZodShape(tool.inputSchema);

            // Log the tool schema to debug the issue (safely handle Zod schema circular references)
            logger.debug(
                `Tool ${tool.name} original inputSchema: ${JSON.stringify(tool.inputSchema, null, 2)}`
            );

            mcpServer.tool(
                tool.name,
                tool.description || `Tool: ${tool.name}`,
                zodShape,
                async (args: any) => {
                    logger.info(
                        `Tool aggregation: executing ${tool.name} with args: ${JSON.stringify(args)}`
                    );
                    try {
                        const result = await mcpManager.executeTool(tool.name, args);
                        logger.info(`Tool aggregation: ${tool.name} completed successfully`);
                        return result;
                    } catch (error) {
                        logger.error(`Tool aggregation: ${tool.name} failed: ${error}`);
                        throw error;
                    }
                }
            );
        }
    }

    logger.info(`Registered ${toolCount} tools from connected MCP servers`);

    // Register resources if available
    try {
        const allResources = await mcpManager.listAllResources();
        logger.info(`Registering ${allResources.length} resources from connected MCP servers`);

        // TODO: Properly handle resource name collisions by prefixing with client name
        let resourceIndex = 0;
        for (const resourceUri of allResources) {
            mcpServer.resource(
                `resource_${resourceIndex}_${resourceUri.replace(/[^a-zA-Z0-9]/g, '_')}`,
                resourceUri,
                async (uri) => {
                    logger.info(`Resource aggregation: reading ${uri.href}`);
                    return await mcpManager.readResource(uri.href);
                }
            );
            resourceIndex++;
        }
    } catch (error) {
        logger.debug(`Skipping resource aggregation: ${error}`);
    }

    // Register prompts if available
    try {
        const allPrompts = await mcpManager.listAllPrompts();
        logger.info(`Registering ${allPrompts.length} prompts from connected MCP servers`);

        for (const promptName of allPrompts) {
            mcpServer.prompt(promptName, `Prompt: ${promptName}`, async (extra) => {
                logger.info(
                    `Prompt aggregation: getting ${promptName} with args: ${JSON.stringify(extra)}`
                );
                return await mcpManager.getPrompt(promptName, {});
            });
        }
    } catch (error) {
        logger.debug(`Skipping prompt aggregation: ${error}`);
    }

    // Connect server to transport
    logger.info(`Connecting MCP tool aggregation server...`);
    await mcpServer.connect(mcpTransport);
    logger.info(`✅ MCP tool aggregation server connected with ${toolCount} tools exposed`);

    return mcpServer;
}
