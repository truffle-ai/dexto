/**
 * API response types inferred from the Hono typed client.
 * These are the single source of truth for API response shapes.
 */
import { client } from './client';

// Helper type to extract the resolved JSON type from a Hono client response
type ExtractResponseData<T> = T extends (...args: any[]) => Promise<infer R>
    ? R extends { json: () => Promise<infer J> }
        ? J
        : never
    : never;

// MCP Server types
type ServersListResponse = ExtractResponseData<typeof client.api.mcp.servers.$get>;
export type McpServer = ServersListResponse['servers'][number];

type ToolsListResponse = ExtractResponseData<
    (typeof client.api.mcp.servers)[':serverId']['tools']['$get']
>;
export type McpTool = ToolsListResponse['tools'][number];
