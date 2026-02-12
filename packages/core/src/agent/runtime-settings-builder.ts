import type { LLMConfig } from '../llm/schemas.js';
import { LLMConfigSchemaRelaxed } from '../llm/schemas.js';
import type { ServerConfigs } from '../mcp/schemas.js';
import { ServerConfigsSchema } from '../mcp/schemas.js';
import type { MemoriesConfig } from '../memory/schemas.js';
import { MemoriesConfigSchema } from '../memory/schemas.js';
import type { PromptsConfig } from '../prompts/schemas.js';
import { PromptsSchema } from '../prompts/schemas.js';
import type { InternalResourcesConfig } from '../resources/schemas.js';
import { InternalResourcesSchema } from '../resources/schemas.js';
import type { SessionConfig } from '../session/schemas.js';
import { SessionConfigSchema } from '../session/schemas.js';
import type { SystemPromptConfig } from '../systemPrompt/schemas.js';
import { SystemPromptConfigSchema } from '../systemPrompt/schemas.js';
import type { ElicitationConfig, ToolConfirmationConfig } from '../tools/schemas.js';
import { ElicitationConfigSchema, ToolConfirmationConfigSchema } from '../tools/schemas.js';
import type { OtelConfiguration } from '../telemetry/schemas.js';
import { OtelConfigurationSchema } from '../telemetry/schemas.js';
import type { AgentCard } from './schemas.js';
import { AgentCardSchema } from './schemas.js';
import type { AgentRuntimeSettings } from './runtime-config.js';

export interface CreateRuntimeSettingsOptions {
    agentId: string;
    llm: LLMConfig;
    systemPrompt: SystemPromptConfig;

    agentCard?: AgentCard | undefined;
    greeting?: string | undefined;
    telemetry?: OtelConfiguration | undefined;
    memories?: MemoriesConfig | undefined;

    mcpServers?: ServerConfigs | undefined;
    sessions?: SessionConfig | undefined;
    toolConfirmation?: ToolConfirmationConfig | undefined;
    elicitation?: ElicitationConfig | undefined;
    internalResources?: InternalResourcesConfig | undefined;
    prompts?: PromptsConfig | undefined;
}

const DEFAULT_TOOL_CONFIRMATION: ToolConfirmationConfig = {
    mode: 'auto-approve',
    allowedToolsStorage: 'memory',
};

export function createRuntimeSettings(options: CreateRuntimeSettingsOptions): AgentRuntimeSettings {
    return {
        agentId: options.agentId,
        llm: LLMConfigSchemaRelaxed.parse(options.llm),
        systemPrompt: SystemPromptConfigSchema.parse(options.systemPrompt),
        mcpServers: ServerConfigsSchema.parse(options.mcpServers ?? {}),
        sessions: SessionConfigSchema.parse(options.sessions ?? {}),
        toolConfirmation: ToolConfirmationConfigSchema.parse(
            options.toolConfirmation ?? DEFAULT_TOOL_CONFIRMATION
        ),
        elicitation: ElicitationConfigSchema.parse(options.elicitation ?? {}),
        internalResources: InternalResourcesSchema.parse(options.internalResources ?? []),
        prompts: PromptsSchema.parse(options.prompts ?? []),
        ...(options.agentCard !== undefined && {
            agentCard: AgentCardSchema.parse(options.agentCard),
        }),
        ...(options.greeting !== undefined && { greeting: options.greeting }),
        ...(options.telemetry !== undefined && {
            telemetry: OtelConfigurationSchema.parse(options.telemetry),
        }),
        ...(options.memories !== undefined && {
            memories: MemoriesConfigSchema.parse(options.memories),
        }),
    };
}
