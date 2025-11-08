/**
 * Spawn Agent Tool
 *
 * Spawns sub-agent tasks with config-driven capabilities.
 * Replaces the hardcoded spawn_task tool with flexible agent config loading.
 *
 * Supports three types of agent references:
 * 1. Built-in agents: 'general-purpose', 'code-reviewer', 'test-runner'
 * 2. File paths: './my-agent.yml' or '/absolute/path/agent.yml'
 * 3. Inline configs: Partial AgentConfig objects
 */

import { z } from 'zod';
import type { InternalTool, ToolExecutionContext } from '../../types.js';
import type { SessionManager } from '../../../session/index.js';
import { logger } from '../../../logger/index.js';
import {
    resolveAgentConfig,
    validateSubAgentConfig,
    type AgentReference,
    type AgentResolutionContext,
} from '../../../config/agent-reference-resolver.js';

/**
 * Zod schema for spawn_agent tool input
 */
const SpawnAgentInputSchema = z
    .object({
        agent: z
            .union([
                z.string(), // Built-in name or file path
                z.record(z.unknown()), // Inline config
            ])
            .describe(
                'Agent to spawn: built-in name ("general-purpose", "code-reviewer", "test-runner"), file path ("./agent.yml"), or inline config object'
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
export function createSpawnAgentTool(sessionManager: SessionManager): InternalTool {
    return {
        id: 'spawn_agent',
        description:
            'Spawn a sub-agent to handle complex analysis, research, or specialized tasks. ' +
            'Sub-agents can have custom system prompts, tool access, and LLM configurations.\n\n' +
            '**Agent Types:**\n' +
            '- Built-in: "general-purpose" (analysis), "code-reviewer" (code review), "test-runner" (testing)\n' +
            '- Custom: "./path/to/agent.yml" (file path to custom agent config)\n' +
            '- Inline: { systemPrompt: "...", internalTools: [...], llm: {...} } (inline config)\n\n' +
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
            const startTime = Date.now();
            let subAgentSessionId: string | undefined;

            try {
                const agentReference: AgentReference = validatedInput.agent;

                // Get parent session depth for hierarchy validation
                const parentSessionId = context?.sessionId || 'unknown';
                let parentDepth = 0;

                if (parentSessionId && parentSessionId !== 'unknown') {
                    const parentSession = await sessionManager.getSession(parentSessionId);
                    if (parentSession) {
                        const metadata = await sessionManager.getSessionMetadata(parentSessionId);
                        parentDepth = metadata?.scopes.depth ?? 0;
                    }
                }

                // Resolve agent reference to full config (avoid leaking inline config secrets)
                logger.debug(`Resolving agent reference`, {
                    refType: typeof agentReference === 'string' ? 'string' : 'inline-config',
                    parentSessionId,
                });
                const resolutionContext: AgentResolutionContext = {
                    workingDir: process.cwd(),
                    parentSessionId,
                };
                const resolved = await resolveAgentConfig(agentReference, resolutionContext);

                // Validate sub-agent config (prevent recursion, check constraints)
                validateSubAgentConfig(resolved.config);

                // Log agent info
                const agentIdentifier =
                    resolved.source.type === 'built-in'
                        ? `built-in:${resolved.source.identifier}`
                        : resolved.source.type === 'file'
                          ? `file:${resolved.source.identifier}`
                          : 'inline';

                logger.info(
                    `Spawning sub-agent [${agentIdentifier}] for task: ${validatedInput.description || 'unnamed task'}`
                );

                // Get lifecycle config from session manager
                const sessionManagerConfig = sessionManager.getConfig();
                const lifecycle = sessionManagerConfig.subAgentLifecycle ?? 'persistent';

                // Create sub-agent session with scopes
                const session = await sessionManager.createSession(undefined, {
                    scopes: {
                        type: 'sub-agent',
                        parentSessionId,
                        depth: parentDepth + 1,
                        lifecycle, // Use configured lifecycle (ephemeral or persistent)
                    },
                    agentConfig: resolved.config,
                    agentIdentifier,
                    metadata: {
                        agentIdentifier,
                    },
                });
                subAgentSessionId = session.id;

                logger.info(
                    `Sub-agent session created: ${session.id} (depth: ${parentDepth + 1}, agent: ${agentIdentifier})`
                );

                // Execute the task in the sub-agent session
                const result = await session.run(validatedInput.prompt);

                // Calculate duration
                const duration = Date.now() - startTime;

                logger.info(
                    `Sub-agent task "${validatedInput.description || 'unnamed'}" completed successfully in ${duration}ms`
                );

                // Return results
                return {
                    result,
                    duration,
                    agent: agentIdentifier,
                };
            } catch (error) {
                const duration = Date.now() - startTime;
                const errorMessage =
                    error instanceof Error ? error.message : 'Unknown error occurred';

                logger.error(
                    `Sub-agent task "${validatedInput.description || 'unnamed'}" failed after ${duration}ms: ${errorMessage}`
                );

                // Return error as result (don't throw to allow parent to handle gracefully)
                return {
                    result: `Task failed: ${errorMessage}`,
                    duration,
                    error: errorMessage,
                    agent: 'failed-to-resolve',
                };
            } finally {
                // Cleanup sub-agent session based on lifecycle policy
                if (subAgentSessionId) {
                    try {
                        const sessionManagerConfig = sessionManager.getConfig();
                        const lifecycle = sessionManagerConfig.subAgentLifecycle ?? 'persistent';

                        if (lifecycle === 'ephemeral') {
                            // Ephemeral: Delete session and history
                            await sessionManager.deleteSession(subAgentSessionId);
                            logger.debug(
                                `Deleted ephemeral sub-agent session: ${subAgentSessionId} (no history preserved)`
                            );
                        } else {
                            // Persistent: Remove from memory, preserve history for review
                            await sessionManager.endSession(subAgentSessionId);
                            logger.debug(
                                `Ended persistent sub-agent session: ${subAgentSessionId} (history preserved)`
                            );
                        }
                    } catch (cleanupError) {
                        logger.error(
                            `Failed to cleanup sub-agent session ${subAgentSessionId}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
                        );
                    }
                }
            }
        },
    };
}
