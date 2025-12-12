import { InternalTool } from '../types.js';
import { SearchService } from '../../search/index.js';
import { ApprovalManager } from '../../approval/manager.js';
import { FileSystemService } from '../../filesystem/index.js';
import { ProcessService } from '../../process/index.js';
import { ResourceManager } from '../../resources/manager.js';
import { createSearchHistoryTool } from './implementations/search-history-tool.js';
import { createAskUserTool } from './implementations/ask-user-tool.js';
import { createReadFileTool } from './implementations/read-file-tool.js';
import { createGlobFilesTool } from './implementations/glob-files-tool.js';
import { createGrepContentTool } from './implementations/grep-content-tool.js';
import { createWriteFileTool } from './implementations/write-file-tool.js';
import { createEditFileTool } from './implementations/edit-file-tool.js';
import { createBashExecTool } from './implementations/bash-exec-tool.js';
import { createBashOutputTool } from './implementations/bash-output-tool.js';
import { createKillProcessTool } from './implementations/kill-process-tool.js';
import { createDelegateToUrlTool } from './implementations/delegate-to-url-tool.js';
import { createListSessionResourcesTool } from './implementations/list-session-resources-tool.js';
import { createGetShareableUrlTool } from './implementations/get-shareable-url-tool.js';
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
    fileSystemService?: FileSystemService;
    processService?: ProcessService;
    resourceManager?: ResourceManager;
    // Future services can be added here:
    // sessionManager?: SessionManager;
    // eventBus?: AgentEventBus;
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
    read_file: {
        factory: (services: InternalToolsServices) =>
            createReadFileTool(services.fileSystemService!),
        requiredServices: ['fileSystemService'] as const,
    },
    glob_files: {
        factory: (services: InternalToolsServices) =>
            createGlobFilesTool(services.fileSystemService!),
        requiredServices: ['fileSystemService'] as const,
    },
    grep_content: {
        factory: (services: InternalToolsServices) =>
            createGrepContentTool(services.fileSystemService!),
        requiredServices: ['fileSystemService'] as const,
    },
    write_file: {
        factory: (services: InternalToolsServices) =>
            createWriteFileTool(services.fileSystemService!),
        requiredServices: ['fileSystemService'] as const,
    },
    edit_file: {
        factory: (services: InternalToolsServices) =>
            createEditFileTool(services.fileSystemService!),
        requiredServices: ['fileSystemService'] as const,
    },
    bash_exec: {
        factory: (services: InternalToolsServices) =>
            createBashExecTool(services.processService!, services.approvalManager!),
        requiredServices: ['processService', 'approvalManager'] as const,
    },
    bash_output: {
        factory: (services: InternalToolsServices) =>
            createBashOutputTool(services.processService!),
        requiredServices: ['processService'] as const,
    },
    kill_process: {
        factory: (services: InternalToolsServices) =>
            createKillProcessTool(services.processService!),
        requiredServices: ['processService'] as const,
    },
    delegate_to_url: {
        factory: (_services: InternalToolsServices) => createDelegateToUrlTool(),
        requiredServices: [] as const,
    },
    list_session_resources: {
        factory: (services: InternalToolsServices) =>
            createListSessionResourcesTool(services.resourceManager!),
        requiredServices: ['resourceManager'] as const,
    },
    get_shareable_url: {
        factory: (services: InternalToolsServices) =>
            createGetShareableUrlTool(services.resourceManager!),
        requiredServices: ['resourceManager'] as const,
    },
};

/**
 * Type-safe registry access
 */
export function getInternalToolInfo(toolName: KnownInternalTool): InternalToolRegistryEntry {
    return INTERNAL_TOOL_REGISTRY[toolName];
}
