import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import type { Context } from 'hono';
import {
    InternalErrorResponse,
    JsonObjectSchema,
    JsonValueSchema,
    ToolInputSchema,
} from '../schemas/responses.js';
import type { OpenAPIRouteSchema } from '../types.js';
type GetAgentFn = (ctx: Context) => DextoAgent | Promise<DextoAgent>;

const ToolInfoSchema = z
    .object({
        id: z.string().describe('Tool identifier'),
        name: z.string().describe('Tool name'),
        description: z.string().describe('Tool description'),
        source: z.enum(['local', 'mcp']).describe('Source of the tool (local or mcp)'),
        serverName: z.string().optional().describe('MCP server name (if source is mcp)'),
        inputSchema: ToolInputSchema.optional().describe('JSON Schema for tool input parameters'),
        _meta: z
            .record(z.string(), JsonValueSchema)
            .optional()
            .describe('Optional tool metadata (e.g., MCP Apps UI resource info)'),
    })
    .strict()
    .describe('Tool information');

const AllToolsResponseSchema = z
    .object({
        tools: z.array(ToolInfoSchema).describe('Array of all available tools'),
        totalCount: z.number().describe('Total number of tools'),
        localCount: z.number().describe('Number of local tools'),
        mcpCount: z.number().describe('Number of MCP tools'),
    })
    .strict()
    .describe('All available tools from all sources');

const allToolsRoute = createRoute({
    method: 'get',
    path: '/tools',
    summary: 'List All Tools',
    description: 'Retrieves all available tools from all sources (local and MCP)',
    tags: ['tools'],
    responses: {
        200: {
            description: 'All tools',
            content: { 'application/json': { schema: AllToolsResponseSchema } },
        },
        500: InternalErrorResponse,
    },
});

export function createToolsRouter(getAgent: GetAgentFn) {
    const app = new OpenAPIHono();

    return app.openapi(allToolsRoute, async (ctx) => {
        const agent = await getAgent(ctx);

        // Get all tools from all sources
        const allTools = await agent.getAllTools();

        // Get MCP tools with server metadata for proper grouping
        const mcpToolsWithServerInfo = agent.getAllMcpToolsWithServerInfo();

        const toolList: z.output<typeof ToolInfoSchema>[] = [];

        let localCount = 0;
        let mcpCount = 0;

        for (const [toolName, toolInfo] of Object.entries(allTools)) {
            // Determine source and extract server name
            let source: 'local' | 'mcp';
            let serverName: string | undefined;

            if (toolName.startsWith('mcp--')) {
                // MCP tool - strip the mcp-- prefix to look up in cache
                const mcpToolName = toolName.substring(5); // Remove 'mcp--' prefix
                const mcpToolInfo = mcpToolsWithServerInfo.get(mcpToolName);
                if (mcpToolInfo) {
                    source = 'mcp';
                    serverName = mcpToolInfo.serverName;
                    mcpCount++;
                } else {
                    // Fallback if not found in cache
                    source = 'mcp';
                    mcpCount++;
                }
            } else {
                // Local tools
                source = 'local';
                localCount++;
            }

            const metadataResult = JsonObjectSchema.safeParse(toolInfo._meta);

            toolList.push({
                id: toolName,
                name: toolName,
                description: toolInfo.description || 'No description available',
                source,
                serverName,
                inputSchema:
                    toolInfo.parameters === undefined
                        ? undefined
                        : ToolInputSchema.parse(toolInfo.parameters),
                _meta: metadataResult.success ? metadataResult.data : undefined,
            });
        }

        // Sort: local first, then MCP
        toolList.sort((a, b) => {
            const sourceOrder = { local: 0, mcp: 1 };
            if (a.source !== b.source) {
                return sourceOrder[a.source] - sourceOrder[b.source];
            }
            return a.name.localeCompare(b.name);
        });

        return ctx.json(
            {
                tools: toolList,
                totalCount: toolList.length,
                localCount,
                mcpCount,
            },
            200
        );
    });
}

type AllToolsRouteSchema = OpenAPIRouteSchema<typeof allToolsRoute, {}>;

export type ToolsRouterSchema = AllToolsRouteSchema;
