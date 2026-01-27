import { InternalTool } from '../types.js';
import { SearchService } from '../../search/index.js';
import { ApprovalManager } from '../../approval/manager.js';
import { ResourceManager } from '../../resources/manager.js';
import type { PromptManager } from '../../prompts/prompt-manager.js';
import { createSearchHistoryTool } from './implementations/search-history-tool.js';
import { createAskUserTool } from './implementations/ask-user-tool.js';
import { createDelegateToUrlTool } from './implementations/delegate-to-url-tool.js';
import { createListResourcesTool } from './implementations/list-resources-tool.js';
import { createGetResourceTool } from './implementations/get-resource-tool.js';
import { createInvokeSkillTool } from './implementations/invoke-skill-tool.js';
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
 * Interface for forking skill execution to an isolated subagent.
 * Implemented by RuntimeService in @dexto/agent-management.
 */
export interface TaskForker {
    /**
     * Execute a task in an isolated subagent context.
     * The subagent has no access to the parent's conversation history.
     *
     * @param options.task - Short description for UI/logs
     * @param options.instructions - Full instructions for the subagent
     * @param options.agentId - Optional agent ID from registry to use for execution
     * @param options.autoApprove - Auto-approve tool calls (default: true for fork skills)
     * @param options.toolCallId - Optional tool call ID for progress events
     * @param options.sessionId - Optional session ID for progress events
     * @returns Result with success status and response/error
     */
    fork(options: {
        task: string;
        instructions: string;
        agentId?: string;
        autoApprove?: boolean;
        toolCallId?: string;
        sessionId?: string;
    }): Promise<{
        success: boolean;
        response?: string;
        error?: string;
    }>;
}

/**
 * Services available to internal tools
 * Add new services here as needed for internal tools
 */
export interface InternalToolsServices {
    searchService?: SearchService;
    approvalManager?: ApprovalManager;
    resourceManager?: ResourceManager;
    promptManager?: PromptManager;
    /** Optional forker for executing skills in isolated context (context: fork) */
    taskForker?: TaskForker;
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
    /** Short description for discovery/UI purposes */
    description: string;
}

/**
 * Internal tool registry - Must match names array exactly (TypeScript enforces this)
 */
export const INTERNAL_TOOL_REGISTRY: Record<KnownInternalTool, InternalToolRegistryEntry> = {
    search_history: {
        factory: (services: InternalToolsServices) =>
            createSearchHistoryTool(services.searchService!),
        requiredServices: ['searchService'] as const,
        description: 'Search through conversation history across sessions',
    },
    ask_user: {
        factory: (services: InternalToolsServices) => createAskUserTool(services.approvalManager!),
        requiredServices: ['approvalManager'] as const,
        requiredFeatures: ['elicitation'] as const,
        description: 'Collect structured input from the user through a form interface',
    },
    delegate_to_url: {
        factory: (_services: InternalToolsServices) => createDelegateToUrlTool(),
        requiredServices: [] as const,
        description: 'Delegate tasks to another A2A-compliant agent via URL',
    },
    list_resources: {
        factory: (services: InternalToolsServices) =>
            createListResourcesTool(services.resourceManager!),
        requiredServices: ['resourceManager'] as const,
        description: 'List available resources (images, files, etc.)',
    },
    get_resource: {
        factory: (services: InternalToolsServices) =>
            createGetResourceTool(services.resourceManager!),
        requiredServices: ['resourceManager'] as const,
        description: 'Access a stored resource to get URLs or metadata',
    },
    invoke_skill: {
        factory: (services: InternalToolsServices) => createInvokeSkillTool(services),
        requiredServices: ['promptManager'] as const,
        description: 'Invoke a skill to load specialized instructions for a task',
    },
};

/**
 * Type-safe registry access
 */
export function getInternalToolInfo(toolName: KnownInternalTool): InternalToolRegistryEntry {
    return INTERNAL_TOOL_REGISTRY[toolName];
}
