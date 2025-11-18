/**
 * Spawn Agent Tool
 *
 * Spawns sub-agent tasks with config-driven capabilities.
 * Agents are resolved from the registry, which includes both bundled agents
 * (general-purpose, code-reviewer) and custom agents installed by the user.
 *
 * The CLI layer provides the agent resolver that handles discovery, installation,
 * and configuration loading from ~/.dexto/agents or bundled sources.
 */

import { z } from 'zod';
import type { InternalTool, ToolExecutionContext } from '../../types.js';
import type { DextoAgent } from '../../../agent/DextoAgent.js';
import type { AgentResolver } from '../registry.js';

/**
 * Zod schema for spawn_agent tool input
 */
const SpawnAgentInputSchema = z
    .object({
        agent: z
            .string()
            .describe(
                'Agent identifier from registry (e.g., "general-purpose", "code-reviewer", or custom agent ID)'
            ),
        prompt: z.string().min(1).describe('Detailed task instructions for the spawned sub-agent'),
        description: z
            .string()
            .optional()
            .describe('Short task description (3-5 words) for tracking/logging'),
    })
    .strict()
    .describe('Spawn a sub-agent with custom capabilities for complex or delegated work');

/**
 * spawn_agent result
 */
interface SpawnAgentResult {
    result: string; // Sub-agent's response
    duration: number; // Execution time in ms
    agent: string; // Resolved agent identifier
    error?: string; // If task failed
}

/**
 * Create spawn_agent internal tool
 */
export function createSpawnAgentTool(
    agent: DextoAgent,
    agentResolver: AgentResolver
): InternalTool {
    return {
        id: 'spawn_agent',
        description:
            'Spawn a sub-agent to handle complex analysis, research, or specialized tasks. ' +
            'Sub-agents can have custom system prompts, tool access, and LLM configurations.\n\n' +
            '**Common Built-in Agents:**\n' +
            '- "general-purpose": General analysis and research (reads files, runs commands, searches)\n' +
            '- "code-reviewer": Code review specialist (thorough analysis, security checks)\n\n' +
            '**Usage:**\n' +
            '```typescript\n' +
            'spawn_agent({\n' +
            '  agent: "code-reviewer",\n' +
            '  prompt: "Review the authentication code in src/auth/",\n' +
            '  description: "Auth code review"\n' +
            '})\n' +
            '```\n\n' +
            'The sub-agent executes autonomously with its configured capabilities and returns results. ' +
            'Cleanup is automatic even on errors.',
        inputSchema: SpawnAgentInputSchema,

        execute: async (
            input: unknown,
            context?: ToolExecutionContext
        ): Promise<SpawnAgentResult> => {
            const validatedInput = SpawnAgentInputSchema.parse(input);

            // Validate session context
            if (!context?.sessionId) {
                throw new Error('Session context is required for spawn_agent tool');
            }

            // Resolve agent identifier to config via injected resolver
            let agentConfig;
            try {
                agentConfig = await agentResolver.resolveAgentConfig(validatedInput.agent);
            } catch (error) {
                throw new Error(
                    `Failed to resolve agent "${validatedInput.agent}": ${error instanceof Error ? error.message : String(error)}`
                );
            }

            // Delegate to DextoAgent.handoff()
            // Pass agent config directly - coordinator will create DextoAgent internally
            const result = await agent.handoff(validatedInput.prompt, {
                agent: agentConfig,
                ...(validatedInput.description && { description: validatedInput.description }),
                parentSessionId: context.sessionId,
            });

            // Map handoff result to tool result format
            return {
                result: result.result,
                duration: result.duration,
                agent: validatedInput.agent,
                ...(result.error && { error: result.error }),
            };
        },
    };
}
