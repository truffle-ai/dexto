import { McpServerConfig } from './schemas.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ToolProvider } from '../tools/types.js';
import { GetPromptResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Interface for MCP clients specifically, that can provide tools
 */
export interface IMCPClient extends ToolProvider {
    // Connection Management
    connect(config: McpServerConfig, serverName: string): Promise<Client>;
    disconnect?(): Promise<void>;

    // Prompt Management
    listPrompts(): Promise<string[]>;
    getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult>;

    // Resource Management
    listResources(): Promise<string[]>;
    readResource(uri: string): Promise<ReadResourceResult>;

    // MCP Client Management
    getConnectedClient(): Promise<Client>;
}
