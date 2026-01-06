import { InternalTool } from '../types.js';
import { SearchService } from '../../search/index.js';
import { ApprovalManager } from '../../approval/manager.js';
import { ResourceManager } from '../../resources/manager.js';
import { createSearchHistoryTool } from './implementations/search-history-tool.js';
import { createAskUserTool } from './implementations/ask-user-tool.js';
import { createDelegateToUrlTool } from './implementations/delegate-to-url-tool.js';
import { createListResourcesTool } from './implementations/list-resources-tool.js';
import { createGetResourceTool } from './implementations/get-resource-tool.js';
import type { KnownInternalTool } from './constants.js';

/**
 * Agent features that tools can depend on.
 * Tools can declare required features via `requiredFeatures` in the registry.
 * If a required feature is disabled, the tool will not be registered and agent startup will fail.
 *
 * To add new features:
 * 1. Add the feature name to this union type (e.g., 'elicitation' | 'file_access' | 'network_access')
 * 2. Add the feature flag derivation in provider.ts `registerInternalTools()`:
 *    ```
 *    const featureFlags: Record<AgentFeature, boolean> = {
 *        elicitation: this.services.approvalManager?.getConfig().elicitation.enabled ?? false,
 *        file_access: config.fileAccess?.enabled ?? false,  // example
 *    };
 *    ```
 * 3. Add `requiredFeatures: ['feature_name'] as const` to tool entries that need it
 *
 * Tools can require multiple features - all must be enabled or startup fails with a clear error.
 */
export type AgentFeature = 'elicitation';

/**
 * Services available to internal tools
 * Add new services here as needed for internal tools
 */
export interface InternalToolsServices {
    searchService?: SearchService;
    approvalManager?: ApprovalManager;
    resourceManager?: ResourceManager;
}

/**
 * Internal tool factory function type
 */
type InternalToolFactory = (services: InternalToolsServices) => InternalTool;

/**
 * Internal tool registry entry type
 */
export interface InternalToolRegistryEntry {
    factory: InternalToolFactory;
    requiredServices: readonly (keyof InternalToolsServices)[];
    requiredFeatures?: readonly AgentFeature[];
}

/**
 * Internal tool registry - Must match names array exactly (TypeScript enforces this)
 */
export const INTERNAL_TOOL_REGISTRY: Record<KnownInternalTool, InternalToolRegistryEntry> = {
    search_history: {
        factory: (services: InternalToolsServices) =>
            createSearchHistoryTool(services.searchService!),
        requiredServices: ['searchService'] as const,
    },
    ask_user: {
        factory: (services: InternalToolsServices) => createAskUserTool(services.approvalManager!),
        requiredServices: ['approvalManager'] as const,
        requiredFeatures: ['elicitation'] as const,
    },
    delegate_to_url: {
        factory: (_services: InternalToolsServices) => createDelegateToUrlTool(),
        requiredServices: [] as const,
    },
    list_resources: {
        factory: (services: InternalToolsServices) =>
            createListResourcesTool(services.resourceManager!),
        requiredServices: ['resourceManager'] as const,
    },
    get_resource: {
        factory: (services: InternalToolsServices) =>
            createGetResourceTool(services.resourceManager!),
        requiredServices: ['resourceManager'] as const,
    },
};

/**
 * Type-safe registry access
 */
export function getInternalToolInfo(toolName: KnownInternalTool): InternalToolRegistryEntry {
    return INTERNAL_TOOL_REGISTRY[toolName];
}
