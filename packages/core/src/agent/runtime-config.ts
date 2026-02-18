import type { LLMConfig, ValidatedLLMConfig } from '../llm/schemas.js';
import type { ServersConfig, ValidatedServersConfig } from '../mcp/schemas.js';
import type { MemoriesConfig, ValidatedMemoriesConfig } from '../memory/schemas.js';
import type { ResourcesConfig, ValidatedResourcesConfig } from '../resources/schemas.js';
import type { SessionConfig, ValidatedSessionConfig } from '../session/schemas.js';
import type { SystemPromptConfig, ValidatedSystemPromptConfig } from '../systemPrompt/schemas.js';
import type {
    ElicitationConfig,
    PermissionsConfig,
    ValidatedPermissionsConfig,
    ValidatedElicitationConfig,
} from '../tools/schemas.js';
import type { PromptsConfig, ValidatedPromptsConfig } from '../prompts/schemas.js';
import type { OtelConfiguration } from '../telemetry/schemas.js';
import type { AgentCard, ValidatedAgentCard } from './schemas.js';

/**
 * Core runtime settings shape (validated + defaulted).
 *
 * DextoAgent is the validation boundary: host layers may validate earlier (e.g. YAML parsing),
 * but core always normalizes runtime settings before use.
 */
export interface AgentRuntimeSettings {
    systemPrompt: ValidatedSystemPromptConfig;
    llm: ValidatedLLMConfig;

    agentCard?: ValidatedAgentCard | undefined;
    greeting?: string | undefined;
    telemetry?: OtelConfiguration | undefined;
    memories?: ValidatedMemoriesConfig | undefined;

    agentId: string;
    mcpServers: ValidatedServersConfig;
    sessions: ValidatedSessionConfig;

    permissions: ValidatedPermissionsConfig;
    elicitation: ValidatedElicitationConfig;

    resources: ValidatedResourcesConfig;
    prompts: ValidatedPromptsConfig;
}

/**
 * Runtime settings input shape (unvalidated / may omit defaulted sections).
 *
 * This is the ergonomic surface for programmatic construction.
 * DextoAgent will validate + default these values internally.
 */
export interface DextoAgentConfigInput {
    systemPrompt: SystemPromptConfig;
    llm: LLMConfig;

    agentCard?: AgentCard | undefined;
    greeting?: string | undefined;
    telemetry?: OtelConfiguration | undefined;
    memories?: MemoriesConfig | undefined;

    agentId: string;
    mcpServers?: ServersConfig | undefined;
    sessions?: SessionConfig | undefined;

    permissions?: PermissionsConfig | undefined;
    elicitation?: ElicitationConfig | undefined;

    resources?: ResourcesConfig | undefined;
    prompts?: PromptsConfig | undefined;
}
