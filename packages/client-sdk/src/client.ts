import { z } from 'zod';
import { HttpClient } from './http-client.js';
import { WebSocketClient, EventHandler } from './websocket-client.js';
import {
    ClientConfig,
    ClientOptions,
    MessageInput,
    MessageResponse,
    SessionInfo,
    LLMConfig,
    McpServer,
    Tool,
    SearchOptions,
    SearchResponse,
    SessionSearchResponse,
    CatalogOptions,
    CatalogResponse,
} from './types.js';
import { ClientError } from './errors.js';
import type { ClientProviderInfo } from './types.js';

import {
    ClientConfigSchema,
    ClientOptionsSchema,
    MessageInputSchema,
    LLMConfigInputSchema,
    SearchOptionsSchema,
    CatalogOptionsSchema,
    validateInput,
} from './schemas.js';

/**
 * Dexto Client SDK - A clean, TypeScript-first SDK for interacting with Dexto API
 *
 * This SDK provides an interface for working with Dexto agents,
 * handling HTTP communication, WebSocket events, and providing excellent DX.
 *
 * @example
 * ```typescript
 * const client = new DextoClient({
 *   baseUrl: 'https://your-dexto-server.com',
 *   apiKey: 'optional-api-key'
 * });
 *
 * await client.connect();
 *
 * const response = await client.sendMessage({
 *   content: 'Hello, how can you help me?'
 * });
 *
 * console.log(response.response);
 * ```
 */
// Internal options with resolved defaults
interface ResolvedClientOptions {
    enableWebSocket: boolean;
    reconnect: boolean;
    reconnectInterval: number;
    debug: boolean;
}

export class DextoClient {
    private http: HttpClient;
    private ws: WebSocketClient | null = null;
    private config: ClientConfig;
    private options: ResolvedClientOptions;

    constructor(config: ClientConfig, options: ClientOptions = {}) {
        // Validate inputs with comprehensive Zod validation
        const validatedConfig = validateInput(ClientConfigSchema, config);
        const validatedOptions = validateInput(ClientOptionsSchema, options);

        // Apply defaults while avoiding undefined properties for exactOptionalPropertyTypes
        this.config = {
            baseUrl: validatedConfig.baseUrl,
            ...(validatedConfig.apiKey !== undefined ? { apiKey: validatedConfig.apiKey } : {}),
            timeout: validatedConfig.timeout ?? 30000,
            retries: validatedConfig.retries ?? 3,
        };

        this.options = {
            enableWebSocket: validatedOptions?.enableWebSocket ?? true,
            reconnect: validatedOptions?.reconnect ?? true,
            reconnectInterval: validatedOptions?.reconnectInterval ?? 5000,
            debug: validatedOptions?.debug ?? false,
        };

        this.http = new HttpClient(this.config);

        if (this.options.enableWebSocket) {
            this.initializeWebSocket();
        }
    }

    private initializeWebSocket() {
        // Convert HTTP URL to WebSocket URL, preserving security scheme
        const wsUrl = this.config.baseUrl.replace(/^https/, 'wss').replace(/^http/, 'ws');

        this.ws = new WebSocketClient(wsUrl, {
            reconnect: this.options.reconnect ?? true,
            reconnectInterval: this.options.reconnectInterval ?? 5000,
        });
    }

    // ============= CONNECTION MANAGEMENT =============

    /**
     * Establish connection to Dexto server (including WebSocket if enabled)
     */
    async connect(): Promise<void> {
        // Test HTTP connection first
        try {
            await this.http.get('/health');
        } catch (error) {
            throw ClientError.connectionFailed(
                this.config.baseUrl,
                error instanceof Error ? error : undefined
            );
        }

        // Connect WebSocket if enabled
        if (this.options.enableWebSocket) {
            if (!this.ws) {
                this.initializeWebSocket();
            }
            if (this.ws) {
                try {
                    await this.ws.connect();
                } catch (error) {
                    if (this.options.debug) {
                        console.warn(
                            `WebSocket connection failed, continuing with HTTP-only mode: ${
                                error instanceof Error ? error.message : String(error)
                            }`
                        );
                    }
                    // Don't fail the entire connection if WebSocket fails
                    this.ws = null;
                }
            }
        }
    }

    /**
     * Disconnect from Dexto server
     */
    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    // ============= MESSAGING =============

    /**
     * Send a message to the Dexto agent
     */
    async sendMessage(input: MessageInput): Promise<MessageResponse> {
        // Validate input
        const validatedInput = validateInput(MessageInputSchema, input);

        if (validatedInput.stream === true) {
            throw ClientError.invalidConfig(
                'MessageInput.stream',
                validatedInput.stream,
                'Use sendMessageStream() for streaming responses'
            );
        }
        const endpoint = '/api/message-sync';

        const requestBody = {
            message: validatedInput.content,
            ...(validatedInput.sessionId && { sessionId: validatedInput.sessionId }),
            ...(validatedInput.imageData && { imageData: validatedInput.imageData }),
            ...(validatedInput.fileData && { fileData: validatedInput.fileData }),
        };

        const response = await this.http.post<MessageResponse>(endpoint, requestBody);
        return response;
    }

    /**
     * Send a message via WebSocket for streaming responses
     */
    sendMessageStream(input: MessageInput): boolean {
        // Validate input
        const validatedInput = validateInput(MessageInputSchema, input);

        if (!this.ws || this.ws.state !== 'open') {
            throw ClientError.connectionFailed(
                'WebSocket endpoint',
                new Error('WebSocket connection not available for streaming')
            );
        }

        return this.ws.send({
            type: 'message',
            content: validatedInput.content,
            ...(validatedInput.sessionId && { sessionId: validatedInput.sessionId }),
            ...(validatedInput.imageData && { imageData: validatedInput.imageData }),
            ...(validatedInput.fileData && { fileData: validatedInput.fileData }),
            stream: true,
        });
    }

    // ============= SESSION MANAGEMENT =============

    /**
     * List all sessions
     */
    async listSessions(): Promise<SessionInfo[]> {
        const response = await this.http.get<{ sessions: SessionInfo[] }>('/api/sessions');
        return response.sessions;
    }

    /**
     * Create a new session
     */
    async createSession(sessionId?: string): Promise<SessionInfo> {
        // Validate sessionId if provided
        if (sessionId !== undefined) {
            validateInput(z.string().min(1, 'Session ID cannot be empty'), sessionId);
        }

        const response = await this.http.post<{ session: SessionInfo }>('/api/sessions', {
            ...(sessionId && { sessionId }),
        });
        return response.session;
    }

    /**
     * Get session details
     */
    async getSession(sessionId: string): Promise<SessionInfo> {
        // Validate sessionId
        validateInput(z.string().min(1, 'Session ID cannot be empty'), sessionId);

        const response = await this.http.get<{ session: SessionInfo }>(
            `/api/sessions/${encodeURIComponent(sessionId)}`
        );
        return response.session;
    }

    /**
     * Get session conversation history
     */
    async getSessionHistory(sessionId: string): Promise<any[]> {
        // Validate sessionId
        validateInput(z.string().min(1, 'Session ID cannot be empty'), sessionId);

        const response = await this.http.get<{ history: unknown[] }>(
            `/api/sessions/${encodeURIComponent(sessionId)}/history`
        );
        return response.history;
    }

    /**
     * Delete a session permanently
     */
    async deleteSession(sessionId: string): Promise<void> {
        // Validate sessionId
        validateInput(z.string().min(1, 'Session ID cannot be empty'), sessionId);

        await this.http.delete(`/api/sessions/${encodeURIComponent(sessionId)}`);
    }

    /**
     * Load a session as the current working session
     */
    async loadSession(sessionId: string | null): Promise<void> {
        // Validate sessionId if not null
        if (sessionId !== null) {
            validateInput(z.string().min(1, 'Session ID cannot be empty'), sessionId);
        }

        const id = sessionId === null ? 'null' : sessionId;
        await this.http.post(`/api/sessions/${encodeURIComponent(id)}/load`);
    }

    /**
     * Get the current working session
     */
    async getCurrentSession(): Promise<string> {
        const response = await this.http.get<{ currentSessionId: string }>('/api/sessions/current');
        return response.currentSessionId;
    }

    /**
     * Reset conversation (clear history while keeping session alive)
     */
    async resetConversation(sessionId?: string): Promise<void> {
        // Validate sessionId if provided
        if (sessionId !== undefined) {
            validateInput(z.string().min(1, 'Session ID cannot be empty'), sessionId);
        }

        await this.http.post('/api/reset', {
            ...(sessionId && { sessionId }),
        });
    }

    // ============= LLM MANAGEMENT =============

    /**
     * Get current LLM configuration
     */
    async getCurrentLLMConfig(sessionId?: string): Promise<LLMConfig> {
        // Validate sessionId if provided
        if (sessionId !== undefined) {
            validateInput(z.string().min(1, 'Session ID cannot be empty'), sessionId);
        }

        const params = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
        const response = await this.http.get<{ config: LLMConfig }>(`/api/llm/current${params}`);
        return response.config;
    }

    /**
     * Switch LLM configuration
     */
    async switchLLM(config: Partial<LLMConfig>, sessionId?: string): Promise<LLMConfig> {
        // Validate input config
        const validatedConfig = validateInput(LLMConfigInputSchema, config);

        // Validate sessionId if provided
        if (sessionId !== undefined) {
            validateInput(z.string().min(1, 'Session ID cannot be empty'), sessionId);
        }

        const requestBody = {
            ...validatedConfig,
            ...(sessionId && { sessionId }),
        };

        const response = await this.http.post<{ config: LLMConfig }>(
            '/api/llm/switch',
            requestBody
        );
        return response.config;
    }

    /**
     * Get available LLM providers and models
     */
    async getLLMProviders(): Promise<Record<string, ClientProviderInfo>> {
        const response = await this.http.get<{ providers: Record<string, ClientProviderInfo> }>(
            '/api/llm/providers'
        );
        return response.providers;
    }

    /**
     * Get LLM catalog with filtering options
     */
    async getLLMCatalog(options: CatalogOptions = {}): Promise<CatalogResponse> {
        // Validate catalog options
        const validatedOptions = validateInput(CatalogOptionsSchema, options);

        const params = new globalThis.URLSearchParams();

        if (validatedOptions.provider) params.set('provider', validatedOptions.provider);
        if (validatedOptions.hasKey !== undefined)
            params.set('hasKey', validatedOptions.hasKey.toString());
        if (validatedOptions.router) params.set('router', validatedOptions.router);
        if (validatedOptions.fileType) params.set('fileType', validatedOptions.fileType);
        if (validatedOptions.defaultOnly) params.set('defaultOnly', 'true');
        if (validatedOptions.mode) params.set('mode', validatedOptions.mode);

        const queryString = params.toString();
        const endpoint = queryString ? `/api/llm/catalog?${queryString}` : '/api/llm/catalog';

        const response = await this.http.get<CatalogResponse>(endpoint);
        return response;
    }

    // ============= MCP SERVER MANAGEMENT =============

    /**
     * List connected MCP servers
     */
    async listMCPServers(): Promise<McpServer[]> {
        const response = await this.http.get<{ servers: McpServer[] }>('/api/mcp/servers');
        return response.servers;
    }

    /**
     * Connect to a new MCP server
     */
    async connectMCPServer(name: string, config: Record<string, unknown>): Promise<void> {
        // Validate server name
        validateInput(z.string().min(1, 'Server name cannot be empty'), name);

        // Validate config is not null/undefined
        if (config === null || config === undefined) {
            throw ClientError.invalidConfig(
                'serverConfig',
                config,
                'Server config cannot be null or undefined'
            );
        }

        await this.http.post('/api/mcp/servers', { name, config });
    }

    /**
     * Disconnect from an MCP server
     */
    async disconnectMCPServer(serverId: string): Promise<void> {
        // Validate serverId
        validateInput(z.string().min(1, 'Server ID cannot be empty'), serverId);

        await this.http.delete(`/api/mcp/servers/${encodeURIComponent(serverId)}`);
    }

    /**
     * Get tools from a specific MCP server
     */
    async getMCPServerTools(serverId: string): Promise<Tool[]> {
        // Validate serverId
        validateInput(z.string().min(1, 'Server ID cannot be empty'), serverId);

        const response = await this.http.get<{ tools: Tool[] }>(
            `/api/mcp/servers/${encodeURIComponent(serverId)}/tools`
        );
        return response.tools;
    }

    /**
     * Execute a tool from an MCP server
     */
    async executeMCPTool(serverId: string, toolName: string, args: unknown): Promise<unknown> {
        // Validate serverId and toolName
        validateInput(z.string().min(1, 'Server ID cannot be empty'), serverId);
        validateInput(z.string().min(1, 'Tool name cannot be empty'), toolName);

        // Validate args is not null/undefined (empty object {} is allowed)
        if (args === null || args === undefined) {
            throw ClientError.invalidConfig(
                'toolArgs',
                args,
                'Tool arguments cannot be null or undefined'
            );
        }

        const response = await this.http.post<{ success: boolean; data: unknown }>(
            `/api/mcp/servers/${encodeURIComponent(serverId)}/tools/${encodeURIComponent(toolName)}/execute`,
            args
        );
        return response.data;
    }

    // ============= SEARCH =============

    /**
     * Search messages across sessions
     */
    async searchMessages(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
        // Validate query
        validateInput(z.string().min(1, 'Search query cannot be empty'), query);

        // Validate search options
        const validatedOptions = validateInput(SearchOptionsSchema, options);

        const params = new globalThis.URLSearchParams();
        params.append('q', query);
        if (validatedOptions.limit !== undefined) {
            params.append('limit', String(validatedOptions.limit));
        }
        if (validatedOptions.offset !== undefined) {
            params.append('offset', String(validatedOptions.offset));
        }
        if (validatedOptions.sessionId) {
            params.append('sessionId', validatedOptions.sessionId);
        }
        if (validatedOptions.role) {
            params.append('role', validatedOptions.role);
        }

        const response = await this.http.get<SearchResponse>(`/api/search/messages?${params}`);
        return response;
    }

    /**
     * Search sessions that contain the query
     */
    async searchSessions(query: string): Promise<SessionSearchResponse> {
        // Validate query
        validateInput(z.string().min(1, 'Search query cannot be empty'), query);

        const params = new globalThis.URLSearchParams({ q: query });
        const response = await this.http.get<SessionSearchResponse>(
            `/api/search/sessions?${params}`
        );
        return response;
    }

    // ============= EVENT HANDLING =============

    /**
     * Subscribe to real-time events
     */
    on(eventType: string, handler: EventHandler): () => void {
        if (!this.ws) {
            if (this.options.debug) {
                console.warn('WebSocket not available, events will not be received');
            }
            return () => {}; // Return no-op unsubscribe function
        }

        return this.ws.on(eventType, handler);
    }

    /**
     * Subscribe to connection state changes
     */
    onConnectionState(
        handler: (state: 'connecting' | 'open' | 'closed' | 'error') => void
    ): () => void {
        if (!this.ws) {
            return () => {};
        }

        return this.ws.onConnectionState(handler);
    }

    // ============= GREETING =============

    /**
     * Get agent greeting message
     */
    async getGreeting(sessionId?: string): Promise<string | null> {
        // Validate sessionId if provided
        if (sessionId !== undefined) {
            validateInput(z.string().min(1, 'Session ID cannot be empty'), sessionId);
        }

        const params = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
        const response = await this.http.get<{ greeting: string | null }>(`/api/greeting${params}`);
        return response.greeting;
    }

    // ============= UTILITY METHODS =============

    /**
     * Get connection status
     */
    get connectionState(): 'connecting' | 'open' | 'closed' | 'error' {
        return this.ws ? this.ws.state : 'closed';
    }

    /**
     * Check if client is connected
     */
    get isConnected(): boolean {
        return this.connectionState === 'open';
    }

    /**
     * Get client configuration
     */
    get clientConfig(): Readonly<ClientConfig> {
        return { ...this.config };
    }
}
