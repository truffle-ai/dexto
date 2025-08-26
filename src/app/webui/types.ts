/**
 * Shared type definitions for Dexto - MCP tool testing playground
 */

//TODO: Replace with types from core
export interface JsonSchemaProperty {
    type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
    description?: string;
    default?: any;
    enum?: Array<string | number | boolean>;
    format?: string;
}

export interface JsonSchema {
    type?: 'object';
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
}

export interface McpServer {
    id: string;
    name: string;
    status: 'connected' | 'disconnected' | 'error' | 'unknown';
}

export interface McpTool {
    id: string;
    name: string;
    description?: string;
    inputSchema?: JsonSchema | null;
}

export interface ToolResult {
    success: boolean;
    data?: any;
    error?: string;
    metadata?: {
        type: string;
        mimeType?: string;
    };
}

// Chat and session types
export interface ConversationSession {
    id: string;
    name: string;
    messages: ChatMessage[];
    createdAt: Date;
    updatedAt: Date;
    metadata?: {
        totalTokens?: number;
        totalCost?: number;
        duration?: number;
    };
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    toolCalls?: ToolCall[];
    attachments?: MessageAttachment[];
}

export interface ToolCall {
    id: string;
    toolName: string;
    input: any;
    output?: any;
    error?: string;
    duration?: number;
}

export interface MessageAttachment {
    id: string;
    type: 'image' | 'file' | 'url';
    name: string;
    url: string;
    mimeType?: string;
    size?: number;
}

// LLM Management types
export interface LLMProvider {
    name: string;
    models: string[];
    supportedRouters: string[];
    supportsBaseURL: boolean;
}

export interface LLMConfig {
    config: {
        provider: string;
        model: string;
        apiKey?: string;
        maxTokens?: number;
        temperature?: number;
        baseURL?: string;
    };
    serviceInfo: {
        provider: string;
        model: string;
        router: string;
        configuredMaxTokens?: number;
        modelMaxTokens?: number;
    };
}

// MCP Server Registry types
export interface ServerRegistryEntry {
    id: string;
    name: string;
    description: string;
    category:
        | 'productivity'
        | 'development'
        | 'research'
        | 'creative'
        | 'data'
        | 'communication'
        | 'custom';
    icon?: string;
    version?: string;
    author?: string;
    homepage?: string;
    config: {
        type: 'stdio' | 'sse' | 'http';
        command?: string;
        args?: string[];
        url?: string;
        baseUrl?: string;
        env?: Record<string, string>;
        headers?: Record<string, string>;
        timeout?: number;
    };
    tags: string[];
    isOfficial: boolean;
    isInstalled: boolean;
    popularity?: number;
    lastUpdated: Date;
    requirements?: {
        platform?: 'win32' | 'darwin' | 'linux' | 'all';
        node?: string;
        python?: string;
        dependencies?: string[];
    };
}

export interface ServerRegistryFilter {
    category?: string;
    tags?: string[];
    search?: string;
    installed?: boolean;
    official?: boolean;
}

export interface ServerRegistryState {
    entries: ServerRegistryEntry[];
    isLoading: boolean;
    error?: string;
    lastUpdated?: Date;
}
