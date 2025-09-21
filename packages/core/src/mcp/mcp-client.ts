import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
    CreateMessageRequest,
    CreateMessageRequestSchema,
    CreateMessageResult,
    ElicitRequestSchema,
    ListRootsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { EventEmitter } from 'events';

import { logger } from '../logger/index.js';
import type {
    ValidatedMcpServerConfig,
    ValidatedStdioServerConfig,
    ValidatedSseServerConfig,
    ValidatedHttpServerConfig,
} from './schemas.js';
import { ToolSet } from '../tools/types.js';
import { IMCPClient, MCPResourceSummary, SamplingRequestHandler } from './types.js';
import type { ElicitationDetails, ElicitationResponse } from '../tools/confirmation/types.js';

// Interface to avoid circular import with UserApprovalProvider
interface UserApprovalProviderInterface {
    requestElicitation(details: ElicitationDetails): Promise<ElicitationResponse>;
}
import { resolveBundledScript } from '../utils/path.js';
import { MCPError } from './errors.js';
import { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

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
    private approvalProvider: UserApprovalProviderInterface | null = null;
    private roots: Array<{ uri: string; name?: string }> = [];
    private samplingEnabled: boolean = true;
    private samplingHandler: SamplingRequestHandler | null = null;

    constructor() {
        super();
    }

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
                    elicitation: {},
                    roots: {
                        listChanged: true,
                    },
                    sampling: {},
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

        logger.debug(`[connectViaSSE] SSE transport: ${JSON.stringify(this.transport, null, 2)}`);
        this.client = new Client(
            {
                name: 'Dexto-sse-mcp-client',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {},
                    elicitation: {},
                    roots: {
                        listChanged: true,
                    },
                    sampling: {},
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
                    elicitation: {},
                    roots: {
                        listChanged: true,
                    },
                    sampling: {},
                },
            }
        );
        try {
            logger.info('Establishing HTTP connection...');
            await this.client.connect(this.transport);
            this.isConnected = true;
            logger.info(`✅ HTTP SERVER ${serverAlias ?? url} CONNECTED`);
            this.setupNotificationHandlers();
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
     * Get the list of prompts provided by this client
     * @returns Array of available prompt names
     * TODO: Turn exception logs back into error and only call this based on capabilities of the server
     */
    async listPrompts(): Promise<string[]> {
        this.ensureConnected();
        try {
            const response = await this.client!.listPrompts();
            logger.debug(`listPrompts response: ${JSON.stringify(response, null, 2)}`);
            return response.prompts.map((p: any) => p.name);
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
            return response.resources.map((r: any) => ({
                uri: r.uri,
                name: r.name,
                description: r.description,
                mimeType: r.mimeType,
            }));
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

        // Set up elicitation request handler for server-to-client elicitation
        try {
            this.client.setRequestHandler(ElicitRequestSchema, async (request: any) => {
                logger.debug(
                    `Received elicitation request: ${JSON.stringify(request.params, null, 2)}`
                );

                try {
                    const response = await this.handleElicitationRequest(request.params);
                    logger.debug(`Elicitation response: ${JSON.stringify(response, null, 2)}`);

                    // Convert our internal response format to MCP SDK format
                    return {
                        action: response.action,
                        content: response.action === 'accept' ? response.data : undefined,
                    };
                } catch (error) {
                    logger.error(`Error handling elicitation request: ${error}`);
                    throw error;
                }
            });
        } catch (error) {
            logger.warn(`Could not set elicitation request handler: ${error}`);
        }

        // Handle roots/list requests so servers can discover client roots
        try {
            this.client.setRequestHandler(ListRootsRequestSchema, async () => ({
                roots: this.getRoots(),
            }));
        } catch (error) {
            logger.warn(`Could not set roots/list request handler: ${error}`);
        }

        // Set up sampling request handler
        try {
            this.client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
                return await this.handleSamplingRequest(request.params);
            });
        } catch (error) {
            logger.warn(`Could not set sampling request handler: ${error}`);
        }

        logger.debug('MCP request handlers registered (elicitation, roots, sampling)');
    }

    /**
     * Handle resource updated notification
     */
    private handleResourceUpdated(params: { uri: string; title?: string }): void {
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
     * Set the approval provider for handling elicitation requests
     */
    setApprovalProvider(provider: UserApprovalProviderInterface): void {
        this.approvalProvider = provider;
    }

    setSamplingHandler(handler: SamplingRequestHandler | null): void {
        this.samplingHandler = handler;
    }

    /**
     * Set the filesystem roots that this client can access
     */
    setRoots(roots: Array<{ uri: string; name?: string }>): void {
        this.roots = [...roots];
        logger.debug(`Set ${roots.length} filesystem roots for MCP client`);
    }

    /**
     * Get the current filesystem roots
     */
    getRoots(): Array<{ uri: string; name?: string }> {
        return [...this.roots];
    }

    /**
     * Notify the server that the roots list has changed
     */
    async notifyRootsListChanged(): Promise<void> {
        if (!this.client || !this.isConnected) {
            logger.debug('Cannot notify roots list changed - client not connected');
            return;
        }

        try {
            await this.client.notification({
                method: 'notifications/roots/listChanged',
                params: {},
            });
            logger.debug('Sent roots/listChanged notification to server');
        } catch (error) {
            logger.warn(`Failed to send roots/listChanged notification: ${error}`);
        }
    }

    /**
     * Set whether sampling is enabled for this client
     */
    setSamplingEnabled(enabled: boolean): void {
        this.samplingEnabled = enabled;
        logger.debug(`Sampling ${enabled ? 'enabled' : 'disabled'} for MCP client`);
    }

    /**
     * Check if sampling is enabled
     */
    isSamplingEnabled(): boolean {
        return this.samplingEnabled;
    }

    /**
     * Request elicitation from the user via the approval provider
     */
    async requestElicitation(details: ElicitationDetails): Promise<ElicitationResponse> {
        if (!this.approvalProvider) {
            throw new Error('No approval provider available for elicitation');
        }

        if (!this.approvalProvider.requestElicitation) {
            throw new Error('Approval provider does not support elicitation');
        }

        // Add server name to the details for user context
        const enrichedDetails = {
            ...details,
            serverName: this.serverAlias || this.serverCommand || 'Unknown MCP Server',
        };

        return await this.approvalProvider.requestElicitation(enrichedDetails);
    }

    /**
     * Handle elicitation request from server
     * This is called when the MCP server sends an elicitation/create request
     * Note: Actual handling of user interaction is delegated to the UserApprovalProvider
     */
    async handleElicitationRequest(params: {
        message: string;
        requestedSchema: object;
        sessionId?: string;
    }): Promise<ElicitationResponse> {
        logger.debug(`Handling elicitation request: ${params.message}`);

        // Delegate to the approval provider
        const details: ElicitationDetails = {
            message: params.message,
            requestedSchema: params.requestedSchema,
        };
        if (params.sessionId) {
            details.sessionId = params.sessionId;
        }
        return await this.requestElicitation(details);
    }

    /**
     * Handle sampling request from server
     * This is called when the MCP server sends a sampling/createMessage request
     */
    async handleSamplingRequest(
        params: CreateMessageRequest['params']
    ): Promise<CreateMessageResult> {
        logger.debug('Handling sampling request');

        if (!this.samplingEnabled) {
            throw new Error('Sampling is disabled for this client');
        }

        if (!this.samplingHandler) {
            throw new Error('No sampling handler configured for this client');
        }

        try {
            if (this.approvalProvider) {
                const elicitationDetails: ElicitationDetails = {
                    message: this.buildSamplingApprovalMessage(params),
                    requestedSchema: {
                        type: 'object',
                        properties: {
                            approved: { type: 'boolean' },
                        },
                        required: ['approved'],
                    },
                };

                const serverLabel = this.serverAlias || this.serverCommand;
                if (serverLabel) {
                    elicitationDetails.serverName = serverLabel;
                }

                const approval = await this.approvalProvider.requestElicitation(elicitationDetails);

                const approved =
                    approval.action === 'accept' && Boolean((approval.data as any)?.approved);

                if (!approved) {
                    return {
                        model: 'user-declined',
                        stopReason: 'user_declined',
                        role: 'assistant',
                        content: {
                            type: 'text',
                            text: 'Sampling request was declined by the user.',
                        },
                    };
                }
            }

            return await this.samplingHandler(params, {
                clientName: this.serverAlias || this.serverCommand || 'Unknown MCP Server',
                serverName: this.serverAlias || this.serverCommand || 'Unknown MCP Server',
            });
        } catch (error) {
            logger.error(`Error handling sampling request: ${error}`);
            throw error;
        }
    }

    private buildSamplingApprovalMessage(params: CreateMessageRequest['params']): string {
        const messageCount = params.messages?.length ?? 0;
        const lastMessage = params.messages?.[messageCount - 1];
        let preview = '';

        if (lastMessage && lastMessage.content?.type === 'text' && lastMessage.content.text) {
            const trimmed = lastMessage.content.text.trim();
            if (trimmed) {
                const maxLength = 160;
                preview = trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
            }
        }

        const serverLabel = this.serverAlias || this.serverCommand || 'MCP server';
        let message = `${serverLabel} requested LLM sampling (${messageCount} message${
            messageCount === 1 ? '' : 's'
        }).`;

        if (preview) {
            message += `\n\nLatest user message preview:\n"${preview}"`;
        }

        if (typeof params.temperature === 'number') {
            message += `\n\nRequested temperature: ${params.temperature}`;
        }

        if (typeof params.maxTokens === 'number') {
            message += `\nRequested max tokens: ${params.maxTokens}`;
        }

        return message;
    }
}
