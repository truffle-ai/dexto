/**
 * Schema Defaults Conventions:
 * – Field-level defaults live in the leaf schemas.
 * – AgentConfig decides if a section is optional by adding `.default({})`.
 *   It never duplicates per-field literal defaults.
 */

import { LLMConfigSchema } from '@core/llm/schemas.js';
import { ServerConfigsSchema as McpServersConfigSchema } from '@core/mcp/schemas.js';
import { SessionConfigSchema } from '@core/session/schemas.js';
import { StorageSchema } from '@core/storage/schemas.js';
import { SystemPromptConfigSchema } from '@core/systemPrompt/schemas.js';
import { InternalToolsSchema, ToolConfirmationConfigSchema } from '@core/tools/schemas.js';
import { z } from 'zod';
import { OtelConfigurationSchema } from '@core/telemetry/schemas.js';

// (agent card overrides are now represented as Partial<AgentCard> and processed via AgentCardSchema)

export const AgentCardSchema = z
    .object({
        name: z.string(), // No default, must be provided by context
        description: z
            .string()
            .default(
                'Dexto is an AI assistant capable of chat and task delegation, accessible via multiple protocols.'
            ),
        url: z.string().url(), // No default, must be provided by context
        provider: z
            .object({
                organization: z.string(),
                url: z.string().url(),
            })
            .optional(), // Remains optional, undefined if not provided
        version: z.string(), // No default, must be provided by context
        documentationUrl: z.string().url().optional(), // Remains optional, undefined if not provided
        capabilities: z
            .object({
                streaming: z.boolean().optional().default(true),
                pushNotifications: z.boolean().optional(), // Default is context-dependent (webSubscriber)
                stateTransitionHistory: z.boolean().optional().default(false),
            })
            .strict()
            .default({}), // Add default for the capabilities object itself
        authentication: z
            .object({
                schemes: z.array(z.string()).default([]),
                credentials: z.string().optional(), // Remains optional
            })
            .strict()
            .default({}), // Add default for the authentication object itself
        defaultInputModes: z.array(z.string()).default(['application/json', 'text/plain']),
        defaultOutputModes: z
            .array(z.string())
            .default(['application/json', 'text/event-stream', 'text/plain']),
        skills: z
            .array(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    description: z.string(),
                    tags: z.array(z.string()),
                    examples: z.array(z.string()).optional(),
                    inputModes: z.array(z.string()).optional().default(['text/plain']),
                    outputModes: z.array(z.string()).optional().default(['text/plain']),
                })
            )
            .default([
                {
                    id: 'chat_with_agent',
                    name: 'chat_with_agent',
                    description: 'Allows you to chat with an AI agent. Send a message to interact.',
                    tags: ['chat', 'AI', 'assistant', 'mcp', 'natural language'],
                    examples: [
                        `Send a JSON-RPC request to /mcp with method: "chat_with_agent" and params: {"message":"Your query..."}`,
                        'Alternatively, use a compatible MCP client library.',
                    ],
                    // inputModes and outputModes will use their own defaults if not specified here
                },
            ]),
    })
    .strict();
// Input type for user-facing API (pre-parsing)

export type AgentCard = z.input<typeof AgentCardSchema>;
// Validated type for internal use (post-parsing)
export type ValidatedAgentCard = z.output<typeof AgentCardSchema>;

export const AgentConfigSchema = z
    .object({
        agentCard: AgentCardSchema.describe('Configuration for the agent card').optional(),
        greeting: z
            .string()
            .max(500)
            .optional()
            .describe('Default greeting text to show when a chat starts (for UI consumption)'),
        systemPrompt: SystemPromptConfigSchema.describe(
            'System prompt: string shorthand or structured config'
        ),
        mcpServers: McpServersConfigSchema.default({}).describe(
            'Configurations for MCP (Model Context Protocol) servers used by the agent'
        ),

        internalTools: InternalToolsSchema,

        llm: LLMConfigSchema.describe('Core LLM configuration for the agent'),

        // Storage configuration
        storage: StorageSchema.default({
            cache: { type: 'in-memory' },
            database: { type: 'in-memory' },
        }).describe('Storage configuration for the agent using cache and database backends'),

        sessions: SessionConfigSchema.default({}).describe('Session management configuration'),

        toolConfirmation: ToolConfirmationConfigSchema.default({}).describe(
            'Tool confirmation and approval configuration'
        ),

        telemetry: OtelConfigurationSchema.describe(
            'Telemetry configuration for the agent'
        ).optional(),
    })
    .strict()
    .describe('Main configuration for an agent, including its LLM and server connections')
    .brand<'ValidatedAgentConfig'>();
// Input type for user-facing API (pre-parsing) - makes fields with defaults optional

export type AgentConfig = z.input<typeof AgentConfigSchema>;
// Validated type for internal use (post-parsing) - all defaults applied
export type ValidatedAgentConfig = z.output<typeof AgentConfigSchema>;
