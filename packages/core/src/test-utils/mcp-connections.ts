import type {
    MCPConnection,
    MCPConnectionChange,
    MCPConnectionLayer,
    MCPConnectionListener,
} from '../mcp/connection-layer.js';
import { connectionFromConfiguredClient } from '../mcp/configured-connections.js';
import type { MCPConnectionClient } from '../mcp/configured-connections.js';

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
    client: MCPConnectionClient,
    name: string = id
): MCPConnection {
    return connectionFromConfiguredClient(id, client, { name });
}
