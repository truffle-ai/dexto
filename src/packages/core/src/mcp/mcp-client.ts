import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { logger } from '../logger/index.js';
import type {
    ValidatedMcpServerConfig,
    ValidatedStdioServerConfig,
    ValidatedSseServerConfig,
    ValidatedHttpServerConfig,
} from './schemas.js';
import { ToolSet } from '../tools/types.js';
import { IMCPClient } from './types.js';
import { resolveBundledScript } from '../utils/path.js';
import { MCPError } from './errors.js';
import { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

// const DEFAULT_TIMEOUT = 60000; // Commented out or remove if not used elsewhere
/**
 * Wrapper on top of Client class provided in model context protocol SDK, to add additional metadata about the server
 */
export class MCPClient implements IMCPClient {
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
                capabilities: { tools: {} },
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
                capabilities: { tools: {} },
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
            { capabilities: { tools: {} } }
        );
        try {
            logger.info('Establishing HTTP connection...');
            await this.client.connect(this.transport);
            this.isConnected = true;
            logger.info(`✅ HTTP SERVER ${serverAlias ?? url} CONNECTED`);
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
    async listResources(): Promise<string[]> {
        this.ensureConnected();
        try {
            const response = await this.client!.listResources();
            logger.debug(`listResources response: ${JSON.stringify(response, null, 2)}`);
            return response.resources.map((r: any) => r.uri);
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
}
