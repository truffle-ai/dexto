import { HttpClient } from './http-client.js';
import { WebSocketClient, EventHandler } from './websocket-client.js';
import {
    ClientConfig,
    ClientOptions,
    MessageInput,
    MessageResponse,
    SessionInfo,
    LLMConfig,
    LLMProvider,
    McpServer,
    Tool,
    SearchOptions,
    SearchResponse,
    SessionSearchResponse,
    DextoClientError,
    CatalogOptions,
    CatalogResponse,
} from './types.js';

/**
 * Dexto Client SDK - A clean, TypeScript-first SDK for interacting with Dexto API
 *
 * This SDK provides a interface for working with Dexto agents,
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
export class DextoClient {
    private http: HttpClient;
    private ws: WebSocketClient | null = null;
    private config: ClientConfig;
    private options: ClientOptions;

    constructor(config: ClientConfig, options: ClientOptions = {}) {
        // Validate required config
        if (!config.baseUrl) {
            throw new DextoClientError('baseUrl is required in client configuration');
        }

        this.config = {
            timeout: 30000,
            retries: 3,
            ...config,
        };

        this.options = {
            enableWebSocket: true,
            reconnect: true,
            reconnectInterval: 5000,
            debug: false,
            ...options,
        };

        this.http = new HttpClient(this.config);

        if (this.options.enableWebSocket) {
            this.initializeWebSocket();
        }
    }

    private initializeWebSocket() {
        // Convert HTTP URL to WebSocket URL
        const wsUrl = this.config.baseUrl.replace(/^https?/, 'ws');

        this.ws = new WebSocketClient(wsUrl, {
            reconnect: this.options.reconnect,
            reconnectInterval: this.options.reconnectInterval,
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
            throw new DextoClientError('Failed to connect to Dexto server', 0, error);
        }

        // Connect WebSocket if enabled
        if (this.ws) {
            try {
                await this.ws.connect();
            } catch (error) {
                if (this.options.debug) {
                    console.warn(
                        'WebSocket connection failed, continuing with HTTP-only mode:',
                        error
                    );
                }
                // Don't fail the entire connection if WebSocket fails
                this.ws = null;
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
        const endpoint = input.stream ? '/api/message' : '/api/message-sync';

        const requestBody = {
            message: input.content,
            ...(input.sessionId && { sessionId: input.sessionId }),
            ...(input.stream && { stream: input.stream }),
            ...(input.imageData && { imageData: input.imageData }),
            ...(input.fileData && { fileData: input.fileData }),
        };

        return await this.http.post<MessageResponse>(endpoint, requestBody);
    }

    /**
     * Send a message via WebSocket for streaming responses
     */
    sendMessageStream(input: MessageInput): boolean {
        if (!this.ws || this.ws.state !== 'open') {
            throw new DextoClientError('WebSocket connection not available for streaming');
        }

        return this.ws.send({
            type: 'message',
            content: input.content,
            ...(input.sessionId && { sessionId: input.sessionId }),
            ...(input.imageData && { imageData: input.imageData }),
            ...(input.fileData && { fileData: input.fileData }),
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
        const response = await this.http.post<{ session: SessionInfo }>('/api/sessions', {
            ...(sessionId && { sessionId }),
        });
        return response.session;
    }

    /**
     * Get session details
     */
    async getSession(sessionId: string): Promise<SessionInfo> {
        const response = await this.http.get<{ session: SessionInfo }>(
            `/api/sessions/${sessionId}`
        );
        return response.session;
    }

    /**
     * Get session conversation history
     */
    async getSessionHistory(sessionId: string): Promise<any[]> {
        const response = await this.http.get<{ history: any[] }>(
            `/api/sessions/${sessionId}/history`
        );
        return response.history;
    }

    /**
     * Delete a session permanently
     */
    async deleteSession(sessionId: string): Promise<void> {
        await this.http.delete(`/api/sessions/${sessionId}`);
    }

    /**
     * Load a session as the current working session
     */
    async loadSession(sessionId: string | null): Promise<void> {
        const id = sessionId === null ? 'null' : sessionId;
        await this.http.post(`/api/sessions/${id}/load`);
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
        await this.http.post('/api/reset', {
            ...(sessionId && { sessionId }),
        });
    }

    // ============= LLM MANAGEMENT =============

    /**
     * Get current LLM configuration
     */
    async getCurrentLLMConfig(sessionId?: string): Promise<LLMConfig> {
        const params = sessionId ? `?sessionId=${sessionId}` : '';
        const response = await this.http.get<{ config: LLMConfig }>(`/api/llm/current${params}`);
        return response.config;
    }

    /**
     * Switch LLM configuration
     */
    async switchLLM(config: Partial<LLMConfig>, sessionId?: string): Promise<LLMConfig> {
        const requestBody = {
            ...config,
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
    async getLLMProviders(): Promise<Record<string, LLMProvider>> {
        const response = await this.http.get<{ providers: Record<string, LLMProvider> }>(
            '/api/llm/providers'
        );
        return response.providers;
    }

    /**
     * Get LLM catalog with filtering options
     */
    async getLLMCatalog(options: CatalogOptions = {}): Promise<CatalogResponse> {
        const params = new URLSearchParams();

        if (options.provider) params.set('provider', options.provider);
        if (options.hasKey !== undefined) params.set('hasKey', options.hasKey.toString());
        if (options.router) params.set('router', options.router);
        if (options.fileType) params.set('fileType', options.fileType);
        if (options.defaultOnly) params.set('defaultOnly', 'true');
        if (options.mode) params.set('mode', options.mode);

        const queryString = params.toString();
        const endpoint = queryString ? `/api/llm/catalog?${queryString}` : '/api/llm/catalog';

        return await this.http.get<CatalogResponse>(endpoint);
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
    async connectMCPServer(name: string, config: any): Promise<void> {
        await this.http.post('/api/mcp/servers', { name, config });
    }

    /**
     * Disconnect from an MCP server
     */
    async disconnectMCPServer(serverId: string): Promise<void> {
        await this.http.delete(`/api/mcp/servers/${serverId}`);
    }

    /**
     * Get tools from a specific MCP server
     */
    async getMCPServerTools(serverId: string): Promise<Tool[]> {
        const response = await this.http.get<{ tools: Tool[] }>(
            `/api/mcp/servers/${serverId}/tools`
        );
        return response.tools;
    }

    /**
     * Execute a tool from an MCP server
     */
    async executeMCPTool(serverId: string, toolName: string, args: any): Promise<any> {
        const response = await this.http.post<{ success: boolean; data: any }>(
            `/api/mcp/servers/${serverId}/tools/${toolName}/execute`,
            args
        );
        return response.data;
    }

    // ============= SEARCH =============

    /**
     * Search messages across sessions
     */
    async searchMessages(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
        const params = new URLSearchParams({
            q: query,
            ...(options.limit && { limit: options.limit.toString() }),
            ...(options.offset && { offset: options.offset.toString() }),
            ...(options.sessionId && { sessionId: options.sessionId }),
            ...(options.role && { role: options.role }),
        });

        return await this.http.get<SearchResponse>(`/api/search/messages?${params}`);
    }

    /**
     * Search sessions that contain the query
     */
    async searchSessions(query: string): Promise<SessionSearchResponse> {
        const params = new URLSearchParams({ q: query });
        return await this.http.get<SessionSearchResponse>(`/api/search/sessions?${params}`);
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
        const params = sessionId ? `?sessionId=${sessionId}` : '';
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
