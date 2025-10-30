import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { EventEmitter } from 'events';
import { z } from 'zod';

import { logger } from '../logger/index.js';
import type { ApprovalManager } from '../approval/manager.js';
import { ApprovalStatus } from '../approval/types.js';
import type {
    ValidatedMcpServerConfig,
    ValidatedStdioServerConfig,
    ValidatedSseServerConfig,
    ValidatedHttpServerConfig,
} from './schemas.js';
import { ToolSet } from '../tools/types.js';
import { IMCPClient, MCPResourceSummary } from './types.js';
import { resolveBundledScript } from '../utils/path.js';
import { MCPError } from './errors.js';
import type {
    GetPromptResult,
    ReadResourceResult,
    Resource,
    ResourceUpdatedNotification,
    Prompt,
} from '@modelcontextprotocol/sdk/types.js';
import {
    ResourceUpdatedNotificationSchema,
    PromptListChangedNotificationSchema,
    ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';

// const DEFAULT_TIMEOUT = 60000; // Commented out or remove if not used elsewhere
/**
 * Wrapper on top of Client class provided in model context protocol SDK, to add additional metadata about the server
 */
export class MCPClient extends EventEmitter implements IMCPClient {
    private client: Client | null = null;
    private transport: any = null;
    private isConnected = false;
    private serverCommand: string | null = null;
    private originalArgs: string[] | null = null;
    private resolvedArgs: string[] | null = null;
    private serverEnv: Record<string, string> | null = null;
    private serverSpawned = false;
    private serverPid: number | null = null;
    private serverAlias: string | null = null;
    private timeout: number = 60000; // Default timeout value
    private approvalManager: ApprovalManager | null = null; // Will be set by MCPManager
    async connect(config: ValidatedMcpServerConfig, serverName: string): Promise<Client> {
        this.timeout = config.timeout ?? 30000; // Use config timeout or Zod schema default
        if (config.type === 'stdio') {
            const stdioConfig: ValidatedStdioServerConfig = config;

            // Auto-resolve npx path on Windows
            let command = stdioConfig.command;
            if (process.platform === 'win32' && command === 'npx') {
                command = 'C:\\Program Files\\nodejs\\npx.cmd';
            }

            return this.connectViaStdio(command, stdioConfig.args, stdioConfig.env, serverName);
        } else if (config.type === 'sse') {
            const sseConfig: ValidatedSseServerConfig = config;
            return this.connectViaSSE(sseConfig.url, sseConfig.headers, serverName);
        } else if (config.type === 'http') {
            const httpConfig: ValidatedHttpServerConfig = config;
            return this.connectViaHttp(httpConfig.url, httpConfig.headers || {}, serverName);
        } else {
            // TypeScript exhaustiveness check - should never reach here
            const _exhaustive: never = config;
            throw MCPError.protocolError(`Unsupported server type: ${JSON.stringify(_exhaustive)}`);
        }
    }

    /**
     * Connect to an MCP server via stdio
     * @param command Command to run
     * @param args Arguments for the command
     * @param env Environment variables
     * @param serverAlias Optional server alias/name to show in logs
     */
    async connectViaStdio(
        command: string,
        args: string[] = [],
        env?: Record<string, string>,
        serverAlias?: string
    ): Promise<Client> {
        // Store server details
        this.serverCommand = command;
        this.originalArgs = [...args];
        this.resolvedArgs = [...this.originalArgs];
        this.serverEnv = env || null;
        this.serverAlias = serverAlias || null;

        // --- Resolve path for bundled node scripts ---
        // TODO: Improve this logic to be less hacky
        if (
            command === 'node' &&
            this.resolvedArgs &&
            this.resolvedArgs.length > 0 &&
            this.resolvedArgs[0]?.startsWith('dist/')
        ) {
            try {
                const scriptRelativePath = this.resolvedArgs[0]!;
                this.resolvedArgs[0] = resolveBundledScript(scriptRelativePath);
                logger.debug(
                    `Resolved bundled script path: ${scriptRelativePath} -> ${this.resolvedArgs[0]}`
                );
            } catch (e) {
                logger.warn(
                    `Failed to resolve path for bundled script ${this.resolvedArgs[0]}: ${JSON.stringify(e, null, 2)}`
                );
            }
        }
        // --- End path resolution ---

        logger.info('=======================================');
        logger.info(`MCP SERVER: ${command} ${this.resolvedArgs.join(' ')}`, null, 'magenta');
        if (env) {
            logger.info('Environment:');
            Object.entries(env).forEach(([key, _]) => {
                logger.info(`  ${key}= [value hidden]`);
            });
        }
        logger.info('=======================================\n');

        const serverName = this.serverAlias
            ? `"${this.serverAlias}" (${command} ${this.resolvedArgs.join(' ')})`
            : `${command} ${this.resolvedArgs.join(' ')}`;
        logger.info(`Connecting to MCP server: ${serverName}`);

        // Create a properly expanded environment by combining process.env with the provided env
        const expandedEnv = {
            ...process.env,
            ...(env || {}),
        };

        // Create transport for stdio connection with expanded environment
        this.transport = new StdioClientTransport({
            command: command,
            args: this.resolvedArgs,
            env: expandedEnv as Record<string, string>,
        });

        this.client = new Client(
            {
                name: 'Dexto-stdio-mcp-client',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {},
                    elicitation: {}, // Enable elicitation capability
                },
            }
        );

        try {
            logger.info('Establishing connection...');
            await this.client.connect(this.transport);

            // If connection is successful, we know the server was spawned
            this.serverSpawned = true;
            logger.info(`✅ Stdio SERVER ${serverName} SPAWNED`);
            logger.info('Connection established!\n\n');
            this.isConnected = true;
            this.setupNotificationHandlers();
            // Set up elicitation handler now that client is connected
            this.setupElicitationHandler();

            return this.client;
        } catch (error: any) {
            logger.error(
                `Failed to connect to MCP server ${serverName}: ${JSON.stringify(error.message, null, 2)}`
            );
            throw error;
        }
    }

    async connectViaSSE(
        url: string,
        headers: Record<string, string> = {},
        serverName: string
    ): Promise<Client> {
        logger.debug(`Connecting to SSE MCP server at url: ${url}`);

        this.transport = new SSEClientTransport(new URL(url), {
            // For regular HTTP requests
            requestInit: {
                headers: headers,
            },
            // Need to implement eventSourceInit for SSE events.
        });

        // Avoid logging full transport to prevent leaking headers/tokens
        logger.debug('[connectViaSSE] SSE transport initialized');
        this.client = new Client(
            {
                name: 'Dexto-sse-mcp-client',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {},
                    elicitation: {}, // Enable elicitation capability
                },
            }
        );

        try {
            logger.info('Establishing connection...');
            await this.client.connect(this.transport);
            // If connection is successful, we know the server was spawned
            this.serverSpawned = true;
            logger.info(`✅ ${serverName} SSE SERVER SPAWNED`);
            logger.info('Connection established!\n\n');
            this.isConnected = true;
            this.setupNotificationHandlers();
            // Set up elicitation handler now that client is connected
            this.setupElicitationHandler();

            return this.client;
        } catch (error: any) {
            logger.error(
                `Failed to connect to SSE MCP server ${url}: ${JSON.stringify(error.message, null, 2)}`
            );
            throw error;
        }
    }

    /**
     * Connect to an MCP server via Streamable HTTP transport
     */
    private async connectViaHttp(
        url: string,
        headers: Record<string, string> = {},
        serverAlias?: string
    ): Promise<Client> {
        logger.info(`Connecting to HTTP MCP server at ${url}`);
        this.transport = new StreamableHTTPClientTransport(new URL(url), {
            requestInit: { headers: headers || {} },
        });
        this.client = new Client(
            { name: 'Dexto-http-mcp-client', version: '1.0.0' },
            {
                capabilities: {
                    tools: {},
                    elicitation: {}, // Enable elicitation capability
                },
            }
        );
        try {
            logger.info('Establishing HTTP connection...');
            await this.client.connect(this.transport);
            this.isConnected = true;
            logger.info(`✅ HTTP SERVER ${serverAlias ?? url} CONNECTED`);
            this.setupNotificationHandlers();
            // Set up elicitation handler now that client is connected
            this.setupElicitationHandler();
            return this.client;
        } catch (error: any) {
            logger.error(
                `Failed to connect to HTTP MCP server ${url}: ${JSON.stringify(error.message, null, 2)}`
            );
            throw error;
        }
    }

    /**
     * Disconnect from the server
     */
    async disconnect(): Promise<void> {
        if (this.transport && typeof this.transport.close === 'function') {
            try {
                await this.transport.close();
                this.isConnected = false;
                this.serverSpawned = false;
                logger.info('Disconnected from MCP server');
            } catch (error: any) {
                logger.error(
                    `Error disconnecting from MCP server: ${JSON.stringify(error.message, null, 2)}`
                );
            }
        }
    }

    /**
     * Call a tool with given name and arguments
     * @param name Tool name
     * @param args Tool arguments
     * @returns Result of the tool execution
     */
    async callTool(name: string, args: any): Promise<any> {
        this.ensureConnected();
        try {
            logger.debug(`Calling tool '${name}' with args: ${JSON.stringify(args, null, 2)}`);

            // Parse args if it's a string (handle JSON strings)
            let toolArgs = args;
            if (typeof args === 'string') {
                try {
                    toolArgs = JSON.parse(args);
                } catch {
                    // If it's not valid JSON, keep as string
                    toolArgs = { input: args };
                }
            }

            // Call the tool with properly formatted arguments
            logger.debug(`Using timeout: ${this.timeout}`);

            const result = await this.client!.callTool(
                { name, arguments: toolArgs },
                undefined, // resultSchema (optional)
                { timeout: this.timeout } // Use server-specific timeout, default 1 minute
            );

            // Log result with base64 truncation for readability
            const logResult = JSON.stringify(
                result,
                (key, value) => {
                    if (key === 'data' && typeof value === 'string' && value.length > 100) {
                        return `[Base64 data: ${value.length} chars]`;
                    }
                    return value;
                },
                2
            );
            logger.debug(`Tool '${name}' result: ${logResult}`);

            // Check for null or undefined result
            if (result === null || result === undefined) {
                return 'Tool executed successfully with no result data.';
            }
            return result;
        } catch (error) {
            logger.error(`Tool call '${name}' failed: ${JSON.stringify(error, null, 2)}`);
            return `Error executing tool '${name}': ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    /**
     * Get the list of tools provided by this client
     * @returns Array of available tools
     */
    async getTools(): Promise<ToolSet> {
        this.ensureConnected();
        const tools: ToolSet = {};
        try {
            // Call listTools with parameters only
            const listToolResult = await this.client!.listTools({});
            logger.silly(`listTools result: ${JSON.stringify(listToolResult, null, 2)}`);

            // Populate tools
            if (listToolResult && listToolResult.tools) {
                listToolResult.tools.forEach((tool: any) => {
                    if (!tool.description) {
                        logger.warn(`Tool '${tool.name}' is missing a description`);
                    }
                    if (!tool.inputSchema) {
                        throw MCPError.invalidToolSchema(tool.name, 'missing input schema');
                    }
                    tools[tool.name] = {
                        description: tool.description ?? '',
                        parameters: tool.inputSchema,
                    };
                });
            } else {
                throw MCPError.protocolError(
                    'listTools did not return the expected structure: missing tools'
                );
            }
        } catch (error) {
            logger.warn(
                `Failed to get tools from MCP server, proceeding with zero tools: ${JSON.stringify(error, null, 2)}`
            );
            return tools;
        }
        return tools;
    }

    /**
     * Get the list of prompts provided by this client with full metadata
     * @returns Array of Prompt objects from MCP SDK with name, title, description, and arguments
     */
    async listPrompts(): Promise<Prompt[]> {
        this.ensureConnected();
        try {
            const response = await this.client!.listPrompts();
            logger.debug(`listPrompts response: ${JSON.stringify(response, null, 2)}`);
            return response.prompts;
        } catch (error) {
            logger.debug(
                `Failed to list prompts from MCP server (optional feature), skipping: ${JSON.stringify(error, null, 2)}`
            );
            return [];
        }
    }

    /**
     * Get a specific prompt definition
     * @param name Name of the prompt
     * @param args Arguments for the prompt (optional)
     * @returns Prompt definition (structure depends on SDK)
     * TODO: Turn exception logs back into error and only call this based on capabilities of the server
     */
    async getPrompt(name: string, args?: any): Promise<GetPromptResult> {
        this.ensureConnected();
        try {
            logger.debug(`Getting prompt '${name}' with args: ${JSON.stringify(args, null, 2)}`);
            // Pass params first, then options
            const response = await this.client!.getPrompt(
                { name, arguments: args },
                { timeout: this.timeout }
            );
            logger.debug(`getPrompt '${name}' response: ${JSON.stringify(response, null, 2)}`);
            return response; // Return the full response object
        } catch (error: any) {
            logger.debug(
                `Failed to get prompt '${name}' from MCP server: ${JSON.stringify(error, null, 2)}`
            );
            throw MCPError.protocolError(
                `Error getting prompt '${name}': ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Get the list of resources provided by this client
     * @returns Array of available resource URIs
     * TODO: Turn exception logs back into error and only call this based on capabilities of the server
     */
    async listResources(): Promise<MCPResourceSummary[]> {
        this.ensureConnected();
        try {
            const response = await this.client!.listResources();
            logger.debug(`listResources response: ${JSON.stringify(response, null, 2)}`);
            return response.resources.map(
                (r: Resource): MCPResourceSummary => ({
                    uri: r.uri,
                    name: r.name,
                    ...(r.description !== undefined && { description: r.description }),
                    ...(r.mimeType !== undefined && { mimeType: r.mimeType }),
                })
            );
        } catch (error) {
            logger.debug(
                `Failed to list resources from MCP server (optional feature), skipping: ${JSON.stringify(error, null, 2)}`
            );
            return [];
        }
    }

    /**
     * Read the content of a specific resource
     * @param uri URI of the resource
     * @returns Content of the resource (structure depends on SDK)
     */
    async readResource(uri: string): Promise<ReadResourceResult> {
        this.ensureConnected();
        try {
            logger.debug(`Reading resource '${uri}'`);
            // Pass params first, then options
            const response = await this.client!.readResource({ uri }, { timeout: this.timeout });
            logger.debug(`readResource '${uri}' response: ${JSON.stringify(response, null, 2)}`);
            return response; // Return the full response object
        } catch (error: any) {
            logger.debug(
                `Failed to read resource '${uri}' from MCP server: ${JSON.stringify(error, null, 2)}`
            );
            throw MCPError.protocolError(
                `Error reading resource '${uri}': ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Check if the client is connected
     */
    getConnectionStatus(): boolean {
        return this.isConnected;
    }

    /**
     * Get the connected client
     */
    getClient(): Client | null {
        return this.client;
    }

    /**
     * Get server status information
     */
    getServerInfo(): {
        spawned: boolean;
        pid: number | null;
        command: string | null;
        originalArgs: string[] | null;
        resolvedArgs: string[] | null;
        env: Record<string, string> | null;
        alias: string | null;
    } {
        return {
            spawned: this.serverSpawned,
            pid: this.serverPid,
            command: this.serverCommand,
            originalArgs: this.originalArgs,
            resolvedArgs: this.resolvedArgs,
            env: this.serverEnv,
            alias: this.serverAlias,
        };
    }

    /**
     * Get the client instance once connected
     * @returns Promise with the MCP client
     */
    async getConnectedClient(): Promise<Client> {
        if (!this.client || !this.isConnected) {
            throw MCPError.clientNotConnected();
        }
        return this.client;
    }

    private ensureConnected(): void {
        if (!this.isConnected || !this.client) {
            throw MCPError.clientNotConnected('Please call connect() first');
        }
    }

    /**
     * Set up notification handlers for MCP server notifications
     */
    private setupNotificationHandlers(): void {
        if (!this.client) return;

        try {
            // Resource updated
            this.client.setNotificationHandler(
                ResourceUpdatedNotificationSchema,
                (notification: ResourceUpdatedNotification) => {
                    // SDK notification.params has type { uri: string; _meta?: {...} } with passthrough
                    // Access uri directly - it's the only guaranteed field per SDK spec
                    this.handleResourceUpdated({
                        uri: notification.params.uri,
                    });
                }
            );
        } catch (error) {
            logger.warn(`Could not set resources/updated notification handler: ${error}`);
        }
        try {
            // Prompts list changed
            this.client.setNotificationHandler(PromptListChangedNotificationSchema, () => {
                this.handlePromptsListChanged();
            });
        } catch (error) {
            logger.warn(`Could not set prompts/list_changed notification handler: ${error}`);
        }
        try {
            // Tools list changed
            this.client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
                this.handleToolsListChanged();
            });
        } catch (error) {
            logger.warn(`Could not set tools/list_changed notification handler: ${error}`);
        }

        logger.debug('MCP notification handlers registered (resources, prompts, tools)');
    }

    /**
     * Handle resource updated notification
     */
    private handleResourceUpdated(params: { uri: string }): void {
        logger.debug(`Resource updated: ${params.uri}`);
        this.emit('resourceUpdated', params);
    }

    /**
     * Handle prompts list changed notification
     */
    private handlePromptsListChanged(): void {
        logger.debug('Prompts list changed');
        this.emit('promptsListChanged');
    }

    /**
     * Handle tools list changed notification
     */
    private handleToolsListChanged(): void {
        logger.debug('Tools list changed');
        this.emit('toolsListChanged');
    }

    /**
     * Set the approval manager for handling elicitation requests
     */
    setApprovalManager(approvalManager: ApprovalManager): void {
        this.approvalManager = approvalManager;
        // Set up handler if client is already connected
        if (this.client) {
            this.setupElicitationHandler();
        }
    }

    /**
     * Set up handler for elicitation requests from MCP server
     */
    private setupElicitationHandler(): void {
        if (!this.client) {
            logger.warn('Cannot setup elicitation handler: client not initialized');
            return;
        }

        if (!this.approvalManager) {
            logger.warn('Cannot setup elicitation handler: approval manager not set');
            return;
        }

        // Create the request schema for elicitation/create
        const ElicitationCreateRequestSchema = z
            .object({
                method: z.literal('elicitation/create'),
                params: z
                    .object({
                        message: z.string(),
                        requestedSchema: z.unknown(),
                    })
                    .passthrough(),
            })
            .passthrough();

        // Set up request handler for elicitation/create
        this.client.setRequestHandler(ElicitationCreateRequestSchema, async (request) => {
            const params = request.params;
            logger.info(
                `Elicitation request from MCP server '${this.serverAlias}': ${params.message}`
            );

            try {
                // Request elicitation through ApprovalManager
                if (!this.approvalManager) {
                    logger.error('Approval manager not available for elicitation request');
                    return { action: 'decline' };
                }

                // Note: MCP elicitation requests do not include sessionId
                // MCP servers are shared across sessions and the MCP protocol doesn't include
                // session context. Elicitations are typically for server-level data (credentials,
                // config) rather than session-specific data.

                // Validate requestedSchema is an object before casting
                if (
                    typeof params.requestedSchema !== 'object' ||
                    params.requestedSchema === null ||
                    Array.isArray(params.requestedSchema)
                ) {
                    logger.error(
                        `Invalid elicitation schema from '${this.serverAlias}': expected object, got ${typeof params.requestedSchema}`
                    );
                    return { action: 'decline' };
                }

                const response = await this.approvalManager.requestElicitation({
                    schema: params.requestedSchema as Record<string, unknown>,
                    prompt: params.message,
                    serverName: this.serverAlias || 'unknown',
                });

                if (response.status === ApprovalStatus.APPROVED && response.data) {
                    // User accepted and provided data
                    const formData =
                        response.data &&
                        typeof response.data === 'object' &&
                        'formData' in response.data
                            ? (response.data as { formData: unknown }).formData
                            : {};
                    logger.info(`Elicitation approved for '${this.serverAlias}', returning data`);
                    return {
                        action: 'accept',
                        content: formData,
                    };
                } else if (response.status === ApprovalStatus.DENIED) {
                    // User declined
                    logger.info(`Elicitation declined for '${this.serverAlias}'`);
                    return {
                        action: 'decline',
                    };
                } else {
                    // User cancelled
                    logger.info(`Elicitation cancelled for '${this.serverAlias}'`);
                    return {
                        action: 'cancel',
                    };
                }
            } catch (error) {
                logger.error(`Elicitation error for '${this.serverAlias}': ${error}`);
                // On error, return decline
                return {
                    action: 'decline',
                };
            }
        });

        logger.debug(`Elicitation handler registered for MCP server '${this.serverAlias}'`);
    }
}
