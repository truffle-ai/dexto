import {
    AgentCardSchema,
    ElicitationConfigSchema,
    LLMConfigSchema,
    LoggerConfigSchema,
    MemoriesConfigSchema,
    ServersConfigSchema as McpServersConfigSchema,
    OtelConfigurationSchema,
    PromptsSchema,
    SessionConfigSchema,
    SystemPromptConfigSchema,
    ToolConfirmationConfigSchema,
    InternalResourcesSchema,
} from '@dexto/core';
import { StorageSchema } from '@dexto/storage/schemas';
import { z } from 'zod';
import { HooksConfigSchema } from './hooks.js';
import { CompactionConfigSchema, DEFAULT_COMPACTION_CONFIG } from './compaction.js';

// ========================================
// DI SURFACE CONFIG (validated in resolver)
// ========================================

/**
 * Unified tool factory entry configuration.
 *
 * Resolution semantics:
 * - omit `tools` entirely → use `image.defaults.tools` (or `[]` if no defaults)
 * - specify `tools` → full replace (arrays are atomic)
 * - each entry can set `enabled: false` to skip that entry entirely
 *
 * Provider-specific fields are validated by the resolver against the selected tool factory's
 * `configSchema`.
 */
export const ToolFactoryEntrySchema = z
    .object({
        type: z.string().describe('Tool factory type identifier'),
        enabled: z.boolean().optional().describe('If false, skip this tool factory entry entirely'),
    })
    .passthrough()
    .describe(
        'Tool factory configuration. Additional fields are type-specific and validated by the resolver.'
    );

export type ToolFactoryEntry = z.output<typeof ToolFactoryEntrySchema>;

// ========================================
// AgentConfig (top-level)
// ========================================

/**
 * Creates the agent config schema.
 */
export function createAgentConfigSchema() {
    return z
        .object({
            // ========================================
            // REQUIRED FIELDS (user must provide or schema validation fails)
            // ========================================
            systemPrompt: SystemPromptConfigSchema.describe(
                'System prompt: string shorthand or structured config'
            ),

            llm: LLMConfigSchema.describe('Core LLM configuration for the agent'),

            // ========================================
            // OPTIONAL FEATURES (undefined if not provided)
            // ========================================
            agentCard: AgentCardSchema.describe('Configuration for the agent card').optional(),

            greeting: z
                .string()
                .max(500)
                .describe('Default greeting text to show when a chat starts (for UI consumption)')
                .optional(),

            telemetry: OtelConfigurationSchema.describe(
                'OpenTelemetry configuration for distributed tracing and observability'
            ).optional(),

            memories: MemoriesConfigSchema.describe(
                'Memory configuration for system prompt inclusion (optional feature)'
            ).optional(),

            agentFile: z
                .object({
                    discoverInCwd: z
                        .boolean()
                        .default(true)
                        .describe(
                            'Whether to discover AGENTS.md/CLAUDE.md/GEMINI.md in the current working directory and include it in the system prompt'
                        ),
                })
                .strict()
                .default({})
                .describe('Agent instruction file discovery configuration'),

            image: z
                .string()
                .describe(
                    'Image package that provides required providers (e.g., "@dexto/image-local"). Optional - platform can load images via CLI flag, environment variable, or static imports.'
                )
                .optional(),

            // ========================================
            // FIELDS WITH DEFAULTS (always present after parsing)
            // ========================================
            agentId: z
                .string()
                .describe(
                    'Unique identifier for this agent instance - CLI enrichment derives from agentCard.name or filename'
                )
                .default('coding-agent'),

            mcpServers: McpServersConfigSchema.describe(
                'Configurations for MCP (Model Context Protocol) servers used by the agent'
            ).default({}),

            tools: z
                .array(ToolFactoryEntrySchema)
                .optional()
                .describe(
                    'Unified tool factory configuration. Omit to use image defaults; provide to fully override.'
                ),

            logger: LoggerConfigSchema.describe(
                'Logger configuration with multi-transport support (file, console, remote) - CLI enrichment adds per-agent file transport'
            ).default({
                level: 'error',
                transports: [{ type: 'console', colorize: true }],
            }),

            storage: StorageSchema.describe(
                'Storage configuration for cache, database, and blob storage - defaults to in-memory, CLI enrichment provides filesystem paths'
            ).default({
                cache: { type: 'in-memory' },
                database: { type: 'in-memory' },
                blob: { type: 'in-memory' },
            }),

            sessions: SessionConfigSchema.describe('Session management configuration').default({}),

            toolConfirmation: ToolConfirmationConfigSchema.describe(
                'Tool confirmation and approval configuration'
            ).default({}),

            elicitation: ElicitationConfigSchema.default({}).describe(
                'Elicitation configuration for user input requests (ask_user tool and MCP server elicitations). Independent from toolConfirmation mode.'
            ),

            internalResources: InternalResourcesSchema.describe(
                'Configuration for internal resources (filesystem, etc.)'
            ).default([]),

            prompts: PromptsSchema.describe(
                'Agent prompts configuration - sample prompts which can be defined inline or referenced from file'
            ).default([]),

            hooks: HooksConfigSchema.describe(
                'Hook configuration. Omit to use image defaults; provide to fully override.'
            ).optional(),

            compaction: CompactionConfigSchema.describe('Context compaction configuration').default(
                DEFAULT_COMPACTION_CONFIG
            ),
        })
        .strict()
        .describe('Main configuration for an agent, including its LLM and server connections')
        .brand<'ValidatedAgentConfig'>();
}

/**
 * Agent config schema.
 */
export const AgentConfigSchema = createAgentConfigSchema();

// Input type for user-facing API (pre-parsing) - makes fields with defaults optional
export type AgentConfig = z.input<typeof AgentConfigSchema>;
// Validated type for internal use (post-parsing) - all defaults applied
export type ValidatedAgentConfig = z.output<typeof AgentConfigSchema>;
