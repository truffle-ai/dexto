import type {
    GetPromptResult,
    Prompt,
    ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';

import type { ToolProvider } from '../tools/types.js';
import type { MCPResourceSummary } from './types.js';

export interface MCPConnection extends ToolProvider {
    /** Stable host-owned identity. Display-name changes must not change this value. */
    id: string;
    /** Human-readable name used to derive friendly aliases. */
    name: string;
    prompts?: {
        list(): Promise<Prompt[]>;
        get(name: string, args?: Record<string, unknown>): Promise<GetPromptResult>;
    };
    resources?: {
        list(): Promise<MCPResourceSummary[]>;
        read(uri: string): Promise<ReadResourceResult>;
    };
}

export type MCPConnectionChange =
    | { type: 'connections-changed' }
    | { type: 'tools-changed'; connectionId: string }
    | { type: 'prompts-changed'; connectionId: string }
    | { type: 'resources-changed'; connectionId: string }
    | { type: 'resource-changed'; connectionId: string; uri: string };

export type MCPConnectionListener = (change: MCPConnectionChange) => Promise<void> | void;

/**
 * Host-owned MCP transport and lifecycle boundary.
 *
 * MCPManager consumes raw connections from this layer and remains the sole owner of normalized
 * catalogs, aliases, canonical identities, and dispatch.
 */
export interface MCPConnectionLayer {
    listConnections(): Promise<readonly MCPConnection[]>;
    onChange(listener: MCPConnectionListener): () => void;
    close(): Promise<void>;
}
