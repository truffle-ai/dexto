import { InternalTool } from '../types.js';
import { SearchService } from '../../search/index.js';
import { createSearchHistoryTool } from './implementations/search-history-tool.js';

/**
 * Services available to internal tools
 * Add new services here as needed for internal tools
 */
export interface InternalToolsServices {
    searchService?: SearchService;
    // Future services can be added here:
    // sessionManager?: SessionManager;
    // storageManager?: StorageManager;
    // eventBus?: AgentEventBus;
}

/**
 * Internal tool factory function type
 */
type InternalToolFactory = (services: InternalToolsServices) => InternalTool;

/**
 * Internal tool names - Manual array preserves literal types for z.enum()
 * Add new tool names here first, then implement in registry below
 */
export const INTERNAL_TOOL_NAMES = ['search_history'] as const;

/**
 * Derive type from names array - preserves literal union
 */
export type KnownInternalTool = (typeof INTERNAL_TOOL_NAMES)[number];

/**
 * Internal tool registry - Must match names array exactly (TypeScript enforces this)
 */
export const INTERNAL_TOOL_REGISTRY: Record<
    KnownInternalTool,
    {
        factory: InternalToolFactory;
        requiredServices: readonly (keyof InternalToolsServices)[];
    }
> = {
    search_history: {
        factory: (services: InternalToolsServices) =>
            createSearchHistoryTool(services.searchService!),
        requiredServices: ['searchService'] as const,
    },
    // Add new tools here - must match INTERNAL_TOOL_NAMES array above
};

/**
 * Type-safe registry access
 */
export function getInternalToolInfo(toolName: KnownInternalTool) {
    return INTERNAL_TOOL_REGISTRY[toolName];
}
