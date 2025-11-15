/**
 * Spawn Agent Tool
 *
 * Spawns sub-agent tasks with config-driven capabilities.
 *
 * Supports two types of agent references:
 * 1. Built-in agents: 'general-purpose', 'code-reviewer'
 * 2. File paths: './my-agent.yml' or '/absolute/path/agent.yml'
 */

import { z } from 'zod';
import type { InternalTool, ToolExecutionContext } from '../../types.js';
import type { DextoAgent } from '../../../agent/DextoAgent.js';

/**
 * Zod schema for spawn_agent tool input
 */
const SpawnAgentInputSchema = z
    .object({
        agent: z
            .string()
            .describe(
                'Agent to spawn: built-in name ("general-purpose", "code-reviewer") or file path ("./agent.yml")'
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
export function createSpawnAgentTool(agent: DextoAgent): InternalTool {
    return {
        id: 'spawn_agent',
        description:
            'Spawn a sub-agent to handle complex analysis, research, or specialized tasks. ' +
            'Sub-agents can have custom system prompts, tool access, and LLM configurations.\n\n' +
            '**Agent Types:**\n' +
            '- Built-in: "general-purpose" (analysis), "code-reviewer" (code review)\n' +
            '- Custom: "./path/to/agent.yml" (file path to custom agent config)\n\n' +
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

            // Delegate to DextoAgent.handoff()
            const result = await agent.handoff(validatedInput.prompt, {
                agent: validatedInput.agent,
                ...(validatedInput.description && { description: validatedInput.description }),
                ...(context?.sessionId && { parentSessionId: context.sessionId }),
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
