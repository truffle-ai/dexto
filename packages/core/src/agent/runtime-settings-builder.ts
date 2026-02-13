import { LLMConfigSchemaRelaxed } from '../llm/schemas.js';
import { ServerConfigsSchema } from '../mcp/schemas.js';
import { MemoriesConfigSchema } from '../memory/schemas.js';
import { PromptsSchema } from '../prompts/schemas.js';
import { InternalResourcesSchema } from '../resources/schemas.js';
import { SessionConfigSchema } from '../session/schemas.js';
import { SystemPromptConfigSchema } from '../systemPrompt/schemas.js';
import { ElicitationConfigSchema, ToolConfirmationConfigSchema } from '../tools/schemas.js';
import { OtelConfigurationSchema } from '../telemetry/schemas.js';
import { AgentCardSchema } from './schemas.js';
import type { AgentRuntimeSettings, AgentRuntimeSettingsInput } from './runtime-config.js';

export function createRuntimeSettings(options: AgentRuntimeSettingsInput): AgentRuntimeSettings {
    return {
        agentId: options.agentId,
        llm: LLMConfigSchemaRelaxed.parse(options.llm),
        systemPrompt: SystemPromptConfigSchema.parse(options.systemPrompt),
        mcpServers: ServerConfigsSchema.parse(options.mcpServers ?? {}),
        sessions: SessionConfigSchema.parse(options.sessions ?? {}),
        toolConfirmation: ToolConfirmationConfigSchema.parse(options.toolConfirmation ?? {}),
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
