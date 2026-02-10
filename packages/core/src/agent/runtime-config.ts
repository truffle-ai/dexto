import type { ValidatedLLMConfig } from '../llm/schemas.js';
import type { LoggerConfig } from '../logger/v2/schemas.js';
import type { ValidatedServerConfigs } from '../mcp/schemas.js';
import type { ValidatedMemoriesConfig } from '../memory/schemas.js';
import type { ValidatedInternalResourcesConfig } from '../resources/schemas.js';
import type { ValidatedSessionConfig } from '../session/schemas.js';
import type { ValidatedStorageConfig } from '../storage/schemas.js';
import type { ValidatedSystemPromptConfig } from '../systemPrompt/schemas.js';
import type {
    ValidatedToolConfirmationConfig,
    ValidatedElicitationConfig,
} from '../tools/schemas.js';
import type { ValidatedPromptsConfig } from '../prompts/schemas.js';
import type { ValidatedPluginsConfig } from '../plugins/schemas.js';
import type { CompactionConfigInput } from '../context/compaction/schemas.js';
import type { OtelConfiguration } from '../telemetry/schemas.js';
import type { ValidatedAgentCard } from './schemas.js';

export type ToolFactoryEntry = {
    type: string;
    enabled?: boolean | undefined;
} & Record<string, unknown>;

/**
 * Core-internal runtime config shape.
 *
 * This is intentionally schema-free: validation lives in `@dexto/agent-config`.
 * Core only assumes it receives a validated + defaulted config object.
 */
export interface AgentRuntimeConfig {
    systemPrompt: ValidatedSystemPromptConfig;
    llm: ValidatedLLMConfig;

    agentCard?: ValidatedAgentCard | undefined;
    greeting?: string | undefined;
    telemetry?: OtelConfiguration | undefined;
    memories?: ValidatedMemoriesConfig | undefined;

    agentFile: {
        discoverInCwd: boolean;
    };

    image?: string | undefined;

    agentId: string;
    mcpServers: ValidatedServerConfigs;

    tools?: ToolFactoryEntry[] | undefined;

    logger: LoggerConfig;
    storage: ValidatedStorageConfig;
    sessions: ValidatedSessionConfig;

    toolConfirmation: ValidatedToolConfirmationConfig;
    elicitation: ValidatedElicitationConfig;

    internalResources: ValidatedInternalResourcesConfig;
    prompts: ValidatedPromptsConfig;

    plugins: ValidatedPluginsConfig;
    compaction: CompactionConfigInput;
}
