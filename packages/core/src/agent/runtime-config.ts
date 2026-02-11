import type { ValidatedLLMConfig } from '../llm/schemas.js';
import type { ValidatedServerConfigs } from '../mcp/schemas.js';
import type { ValidatedMemoriesConfig } from '../memory/schemas.js';
import type { ValidatedInternalResourcesConfig } from '../resources/schemas.js';
import type { ValidatedSessionConfig } from '../session/schemas.js';
import type { ValidatedSystemPromptConfig } from '../systemPrompt/schemas.js';
import type {
    ValidatedToolConfirmationConfig,
    ValidatedElicitationConfig,
} from '../tools/schemas.js';
import type { ValidatedPromptsConfig } from '../prompts/schemas.js';
import type { CompactionConfigInput } from '../context/compaction/schemas.js';
import type { OtelConfiguration } from '../telemetry/schemas.js';
import type { ValidatedAgentCard } from './schemas.js';

/**
 * Core runtime settings shape.
 *
 * This contains only config-based surfaces that core uses at runtime.
 * Validation lives in `@dexto/agent-config` (core assumes it receives validated + defaulted values).
 */
export interface AgentRuntimeSettings {
    systemPrompt: ValidatedSystemPromptConfig;
    llm: ValidatedLLMConfig;

    agentCard?: ValidatedAgentCard | undefined;
    greeting?: string | undefined;
    telemetry?: OtelConfiguration | undefined;
    memories?: ValidatedMemoriesConfig | undefined;

    agentId: string;
    mcpServers: ValidatedServerConfigs;
    sessions: ValidatedSessionConfig;

    toolConfirmation: ValidatedToolConfirmationConfig;
    elicitation: ValidatedElicitationConfig;

    internalResources: ValidatedInternalResourcesConfig;
    prompts: ValidatedPromptsConfig;

    compaction: CompactionConfigInput;
}
