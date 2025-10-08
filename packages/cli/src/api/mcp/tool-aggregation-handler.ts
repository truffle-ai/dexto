import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { MCPManager, logger, type ValidatedServerConfigs, jsonSchemaToZodShape } from '@dexto/core';
import { z } from 'zod';

/**
 * Initializes MCP server for tool aggregation mode.
 * Instead of exposing an AI agent, this directly exposes all tools from connected MCP servers.
 */
export async function initializeMcpToolAggregationServer(
    serverConfigs: ValidatedServerConfigs,
    mcpTransport: Transport,
    serverName: string,
    serverVersion: string,
    _strict: boolean
): Promise<McpServer> {
    // Create MCP manager with no confirmation provider (tools are auto-approved)
    const mcpManager = new MCPManager();

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

    const toolDefinitions = await mcpManager.getAllTools();
    let toolCount = 0;

    for (const [toolName, toolDef] of Object.entries(toolDefinitions)) {
        toolCount++;
        const jsonSchema = toolDef.parameters ?? { type: 'object', properties: {} };
        const paramsShape = jsonSchemaToZodShape(jsonSchema);
        const _paramsSchema = z.object(paramsShape);
        // TODO: (355) Use z.output instead of z.infer, add linter rule for enforcing this
        // https://github.com/truffle-ai/dexto/pull/355#discussion_r2412898960
        type ToolArgs = z.infer<typeof _paramsSchema>;

        // TODO: (355) This if condition is not necessary, logger.debug already handles this and only shows if log level matches
        // https://github.com/truffle-ai/dexto/pull/355#discussion_r2412900959
        const level = typeof logger.getLevel === 'function' ? logger.getLevel() : 'info';
        if (level === 'debug' || level === 'verbose' || level === 'silly') {
            logger.debug(
                `Registering tool '${toolName}' with schema: ${JSON.stringify(jsonSchema)}`
            );
        }

        mcpServer.tool(
            toolName,
            toolDef.description || `Tool: ${toolName}`,
            paramsShape,
            async (args: ToolArgs) => {
                logger.info(`Tool aggregation: executing ${toolName}`);
                try {
                    const result = await mcpManager.executeTool(toolName, args);
                    logger.info(`Tool aggregation: ${toolName} completed successfully`);
                    return result;
                } catch (error) {
                    logger.error(`Tool aggregation: ${toolName} failed: ${error}`);
                    throw error;
                }
            }
        );
    }

    logger.info(`Registered ${toolCount} tools from connected MCP servers`);

    // Register resources if available
    try {
        const allResources = await mcpManager.listAllResources();
        logger.info(`Registering ${allResources.length} resources from connected MCP servers`);

        // TODO: (355) Verify if client collisions are handled and re-test this aggregator flow
        // https://github.com/truffle-ai/dexto/pull/355#discussion_r2412904294
        allResources.forEach((resource, index) => {
            const safeId = resource.key.replace(/[^a-zA-Z0-9]/g, '_');
            mcpServer.resource(`resource_${index}_${safeId}`, resource.key, async () => {
                logger.info(`Resource aggregation: reading ${resource.key}`);
                return await mcpManager.readResource(resource.key);
            });
        });
    } catch (error) {
        logger.debug(`Skipping resource aggregation: ${error}`);
    }

    // Register prompts if available
    try {
        const allPrompts = await mcpManager.listAllPrompts();
        logger.info(`Registering ${allPrompts.length} prompts from connected MCP servers`);

        for (const promptName of allPrompts) {
            mcpServer.prompt(promptName, `Prompt: ${promptName}`, async (extra) => {
                logger.info(`Prompt aggregation: resolving ${promptName}`);
                const promptArgs =
                    (extra && 'arguments' in extra ? extra.arguments : undefined) ?? {};
                return await mcpManager.getPrompt(promptName, promptArgs);
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
