import type { ApprovalManager } from '../approval/manager.js';
import type { Logger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import type {
    MCPConnection,
    MCPConnectionChange,
    MCPConnectionLayer,
    MCPConnectionListener,
} from './connection-layer.js';
import { MCPError } from './errors.js';
import { DextoMcpClient } from './mcp-client.js';
import type { ValidatedMcpServerConfig, ValidatedServersConfig } from './schemas.js';
import type { McpAuthProvider, McpAuthProviderFactory, McpClient } from './types.js';
import { normalizeMcpNamespace } from './tool-name.js';

export type ConnectionFailure = { message: string; code?: string };

export interface MCPConnectionManagement {
    connect(name: string, config: ValidatedMcpServerConfig): Promise<void>;
    remove(name: string): Promise<void>;
    restart(name: string): Promise<void>;
    has(name: string): boolean;
    getClients(): Map<string, McpClient>;
    getFailures(): Readonly<Record<string, ConnectionFailure>>;
    getAuthProvider(name: string): McpAuthProvider | null | undefined;
    getConfig(name: string): ValidatedMcpServerConfig | undefined;
    setAuthProviderFactory(factory: McpAuthProviderFactory | null): void;
}

export type MCPConnectionClient = Pick<McpClient, 'callTool' | 'getConnectedClient'> &
    Partial<Pick<McpClient, 'listPrompts' | 'getPrompt' | 'listResources' | 'readResource'>>;

export function connectionFromConfiguredClient(
    id: string,
    client: MCPConnectionClient,
    options: { name?: string; prompts?: boolean; resources?: boolean } = {}
): MCPConnection {
    const listPrompts = client.listPrompts?.bind(client);
    const getPrompt = client.getPrompt?.bind(client);
    const listResources = client.listResources?.bind(client);
    const readResource = client.readResource?.bind(client);
    return {
        id,
        name: options.name ?? id,
        namespace: normalizeMcpNamespace(id),
        listTools: async () => (await (await client.getConnectedClient()).listTools({})).tools,
        callTool: (toolName, args, context) => client.callTool(toolName, args, context),
        ...(options.prompts !== false && listPrompts && getPrompt
            ? {
                  prompts: {
                      list: listPrompts,
                      get: getPrompt,
                  },
              }
            : {}),
        ...(options.resources !== false && listResources && readResource
            ? {
                  resources: {
                      list: listResources,
                      read: readResource,
                  },
              }
            : {}),
    };
}

function failureFrom(error: unknown): ConnectionFailure {
    const message = error instanceof Error ? error.message : String(error);
    if (error === null || typeof error !== 'object' || !('code' in error)) {
        return { message };
    }
    return { message, code: String(error.code) };
}

/** Config-defined stdio/SSE/HTTP MCP connections used by Core and CLI hosts. */
export class ConfiguredMCPConnections implements MCPConnectionLayer, MCPConnectionManagement {
    private readonly clients = new Map<string, DextoMcpClient>();
    private readonly connections = new Map<string, MCPConnection>();
    private readonly configs = new Map<string, ValidatedMcpServerConfig>();
    private readonly failures: Record<string, ConnectionFailure> = {};
    private readonly listeners = new Set<MCPConnectionListener>();
    private readonly stopClientListeners = new Map<string, () => void>();
    private authProviderFactory: McpAuthProviderFactory | null;
    private readonly approvalManager: ApprovalManager | null;
    private readonly logger: Logger;

    constructor(
        logger: Logger,
        options: {
            authProviderFactory?: McpAuthProviderFactory | null;
            approvalManager?: ApprovalManager | null;
        } = {}
    ) {
        this.logger = logger.createChild(DextoLogComponent.MCP);
        this.authProviderFactory = options.authProviderFactory ?? null;
        this.approvalManager = options.approvalManager ?? null;
    }

    async listConnections(): Promise<readonly MCPConnection[]> {
        return Array.from(this.connections.values());
    }

    onChange(listener: MCPConnectionListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private async emit(change: MCPConnectionChange): Promise<void> {
        await Promise.all(Array.from(this.listeners, (listener) => listener(change)));
    }

    setAuthProviderFactory(factory: McpAuthProviderFactory | null): void {
        this.authProviderFactory = factory;
        for (const client of this.clients.values()) {
            client.setAuthProviderFactory(factory);
        }
    }

    async initializeFromConfig(serverConfigs: ValidatedServersConfig): Promise<void> {
        if (Object.keys(serverConfigs).length === 0) {
            this.logger.info('No MCP servers configured - running without external tools');
            return;
        }

        const successful = new Set<string>();
        const strictServers: string[] = [];
        const connections: Promise<void>[] = [];

        for (const [name, config] of Object.entries(serverConfigs)) {
            if (config.enabled === false) {
                this.logger.info(`Skipping disabled server '${name}'`);
                continue;
            }
            if (config.connectionMode === 'strict') {
                strictServers.push(name);
            }
            connections.push(
                this.connect(name, config)
                    .then(() => {
                        successful.add(name);
                    })
                    .catch(() => undefined)
            );
        }

        await Promise.all(connections);

        const failedStrictServers = strictServers.filter((name) => !successful.has(name));
        if (failedStrictServers.length === 0) return;

        const details = failedStrictServers
            .map((name) => `${name}: ${this.failures[name]?.message ?? 'Unknown error'}`)
            .join('; ');
        await this.close();
        throw MCPError.connectionFailed('strict servers', details);
    }

    async connect(name: string, config: ValidatedMcpServerConfig): Promise<void> {
        if (this.clients.has(name)) {
            this.logger.warn(`Client '${name}' is already connected.`);
            return;
        }

        const client = new DextoMcpClient(this.logger);
        client.setAuthProviderFactory(this.authProviderFactory);
        if (this.approvalManager) {
            client.setApprovalManager(this.approvalManager);
        }

        try {
            const connectedClient = await client.connect(config, name);
            const capabilities = connectedClient.getServerCapabilities();
            this.clients.set(name, client);
            this.connections.set(
                name,
                connectionFromConfiguredClient(name, client, {
                    prompts: capabilities?.prompts !== undefined,
                    resources: capabilities?.resources !== undefined,
                })
            );
            this.configs.set(name, config);
            delete this.failures[name];
            this.stopClientListeners.set(name, this.listenToClient(name, client));
            await this.emit({ type: 'connections-changed' });
        } catch (error) {
            if (this.clients.get(name) === client) {
                this.detachClient(name);
                this.clients.delete(name);
                this.connections.delete(name);
                this.configs.delete(name);
                try {
                    await client.disconnect();
                } catch (disconnectError) {
                    this.logger.error(
                        `Failed to roll back MCP connection '${name}': ${disconnectError instanceof Error ? disconnectError.message : String(disconnectError)}`
                    );
                }
            }
            const failure = failureFrom(error);
            this.failures[name] = failure;
            throw MCPError.connectionFailed(name, failure.message);
        }
    }

    async remove(name: string): Promise<void> {
        const client = this.clients.get(name);
        if (client) {
            this.detachClient(name);
            try {
                await client.disconnect();
            } catch (error) {
                this.logger.error(
                    `Error disconnecting client '${name}': ${error instanceof Error ? error.message : String(error)}`
                );
            }
            this.clients.delete(name);
            this.connections.delete(name);
            this.configs.delete(name);
            await this.emit({ type: 'connections-changed' });
        }
        delete this.failures[name];
    }

    async restart(name: string): Promise<void> {
        const config = this.configs.get(name);
        if (!config) {
            throw MCPError.serverNotFound(name, 'Server config not found - cannot restart');
        }

        const client = this.clients.get(name);
        if (client) {
            this.detachClient(name);
            try {
                await client.disconnect();
            } catch (error) {
                this.logger.warn(
                    `Error disconnecting server '${name}' during restart: ${error instanceof Error ? error.message : String(error)}`
                );
            }
            this.clients.delete(name);
            this.connections.delete(name);
        }
        delete this.failures[name];

        try {
            await this.connect(name, config);
        } catch (error) {
            this.configs.set(name, config);
            throw error;
        }
    }

    getClients(): Map<string, McpClient> {
        return new Map(this.clients);
    }

    has(name: string): boolean {
        return this.clients.has(name);
    }

    getFailures(): Readonly<Record<string, ConnectionFailure>> {
        return { ...this.failures };
    }

    getAuthProvider(name: string): McpAuthProvider | null | undefined {
        const client = this.clients.get(name);
        return client ? client.getCurrentAuthProvider() : null;
    }

    getConfig(name: string): ValidatedMcpServerConfig | undefined {
        return this.configs.get(name);
    }

    async close(): Promise<void> {
        await Promise.all(
            Array.from(this.clients, async ([name, client]) => {
                this.detachClient(name);
                try {
                    await client.disconnect();
                } catch (error) {
                    this.logger.error(
                        `Error disconnecting client '${name}': ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            })
        );
        this.clients.clear();
        this.connections.clear();
        this.configs.clear();
        for (const name of Object.keys(this.failures)) delete this.failures[name];
        try {
            await this.emit({ type: 'connections-changed' });
        } finally {
            this.listeners.clear();
        }
    }

    private listenToClient(name: string, client: McpClient): () => void {
        const toolsChanged = () =>
            this.emitFromClient({ type: 'tools-changed', connectionId: name });
        const promptsChanged = () =>
            this.emitFromClient({ type: 'prompts-changed', connectionId: name });
        const resourcesChanged = () =>
            this.emitFromClient({ type: 'resources-changed', connectionId: name });
        const resourceChanged = (params: { uri: string }) =>
            this.emitFromClient({
                type: 'resource-changed',
                connectionId: name,
                uri: params.uri,
            });

        client.on('toolsListChanged', toolsChanged);
        client.on('promptsListChanged', promptsChanged);
        client.on('resourcesListChanged', resourcesChanged);
        client.on('resourceUpdated', resourceChanged);
        return () => {
            client.off('toolsListChanged', toolsChanged);
            client.off('promptsListChanged', promptsChanged);
            client.off('resourcesListChanged', resourcesChanged);
            client.off('resourceUpdated', resourceChanged);
        };
    }

    private emitFromClient(change: MCPConnectionChange): void {
        void this.emit(change).catch((error: unknown) => {
            this.logger.error(
                `Failed to apply MCP invalidation: ${error instanceof Error ? error.message : String(error)}`
            );
        });
    }

    private detachClient(name: string): void {
        this.stopClientListeners.get(name)?.();
        this.stopClientListeners.delete(name);
    }
}
