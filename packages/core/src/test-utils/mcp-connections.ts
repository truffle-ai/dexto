import type {
    MCPConnection,
    MCPConnectionChange,
    MCPConnectionLayer,
    MCPConnectionListener,
} from '../mcp/connection-layer.js';
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpClient } from '../mcp/types.js';
import { normalizeMcpNamespace } from '../mcp/tool-name.js';

type TestMCPConnectionClient = Pick<McpClient, 'callTool' | 'getTools'> &
    Partial<Pick<McpClient, 'getPrompt' | 'listPrompts' | 'listResources' | 'readResource'>>;

export class TestMCPConnections implements MCPConnectionLayer {
    private readonly connections = new Map<string, MCPConnection>();
    private readonly listeners = new Set<MCPConnectionListener>();

    async listConnections(): Promise<readonly MCPConnection[]> {
        return Array.from(this.connections.values());
    }

    onChange(listener: MCPConnectionListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async close(): Promise<void> {
        this.connections.clear();
        this.listeners.clear();
    }

    set(connection: MCPConnection): void {
        this.connections.set(connection.id, connection);
    }

    delete(connectionId: string): void {
        this.connections.delete(connectionId);
    }

    async announce(change: MCPConnectionChange): Promise<void> {
        await Promise.all(Array.from(this.listeners, (listener) => listener(change)));
    }
}

export function connectionFromClient(
    id: string,
    client: TestMCPConnectionClient,
    name: string = id
): MCPConnection {
    const listPrompts = client.listPrompts?.bind(client);
    const getPrompt = client.getPrompt?.bind(client);
    const listResources = client.listResources?.bind(client);
    const readResource = client.readResource?.bind(client);
    return {
        id,
        name,
        namespace: normalizeMcpNamespace(id),
        listTools: async () =>
            Object.entries(await client.getTools()).map(([toolName, definition]) =>
                ToolSchema.parse({
                    name: toolName,
                    description: definition.description,
                    inputSchema: definition.parameters,
                    ...(definition.outputSchema === undefined
                        ? {}
                        : { outputSchema: definition.outputSchema }),
                    ...(definition.annotations === undefined
                        ? {}
                        : { annotations: definition.annotations }),
                    ...(definition._meta === undefined ? {} : { _meta: definition._meta }),
                })
            ),
        callTool: (toolName, args, context) => client.callTool(toolName, args, context),
        ...(listPrompts && getPrompt ? { prompts: { list: listPrompts, get: getPrompt } } : {}),
        ...(listResources && readResource
            ? { resources: { list: listResources, read: readResource } }
            : {}),
    };
}
