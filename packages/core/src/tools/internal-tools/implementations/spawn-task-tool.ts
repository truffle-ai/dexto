/**
 * Spawn Task Tool
 *
 * Spawns sub-agent tasks for parallel or delegated work
 * with proper session hierarchy, scoping, and cleanup
 */

import { z } from 'zod';
import type { InternalTool, ToolExecutionContext } from '../../types.js';
import type { SessionManager, SessionData } from '../../../session/index.js';
import { logger } from '../../../logger/index.js';
import type { SubAgentTaskType } from '../../tool-profiles.js';
import { getToolProfile } from '../../tool-profiles.js';

/**
 * Zod schema for spawn_task tool input
 */
const SpawnTaskInputSchema = z
    .object({
        task_type: z
            .enum(['general-purpose', 'code-reviewer', 'test-runner'])
            .describe(
                'The type of sub-agent to spawn: general-purpose (for analysis, research, comparisons), code-reviewer (for code review), test-runner (for running tests)'
            ),
        description: z
            .string()
            .min(1)
            .describe('Short task description (3-5 words) for tracking/logging'),
        prompt: z.string().min(1).describe('Detailed task instructions for the spawned sub-agent'),
        context: z
            .record(z.unknown())
            .optional()
            .describe('Additional context to pass to the sub-agent (free-form JSON)'),
    })
    .strict()
    .describe('Spawn a new sub-agent task for complex analysis or delegated work');

/**
 * Create spawn_task internal tool
 */
export function createSpawnTaskTool(sessionManager: SessionManager): InternalTool {
    return {
        id: 'spawn_task',
        description:
            'Spawn a sub-agent to handle complex analysis, research, or multi-step tasks. Use this when you need to:\n' +
            '- Analyze codebases, compare files, or review code\n' +
            '- Research documentation or gather information from multiple sources\n' +
            '- Delegate specialized work (code review, testing, bug analysis)\n' +
            '- Break down complex tasks into focused sub-tasks\n' +
            'The sub-agent has full access to all tools (file operations, search, bash) and returns results when complete. ' +
            'IMPORTANT: Use spawn_task instead of bash commands for tasks requiring analysis or multiple operations.',
        inputSchema: SpawnTaskInputSchema,

        execute: async (input: unknown, context?: ToolExecutionContext): Promise<unknown> => {
            const validatedInput = SpawnTaskInputSchema.parse(input);
            const startTime = Date.now();
            let subAgentSessionId: string | undefined;

            try {
                // Get parent session data to extract depth for hierarchy
                const parentSessionId = context?.sessionId;
                let parentDepth = 0;

                if (parentSessionId) {
                    const parentSession = await sessionManager.getSession(parentSessionId);
                    if (parentSession) {
                        // Get parent session data from storage to access depth
                        const sessionData = await sessionManager
                            .getSession(parentSessionId)
                            .then((s) => s?.id);
                        if (sessionData) {
                            // Default to depth 0 if not found (primary session)
                            parentDepth = 0; // TODO: Get actual depth from session metadata
                        }
                    }
                }

                // Get tool profile for this task type
                const profile = getToolProfile(validatedInput.task_type as SubAgentTaskType);
                logger.info(
                    `Creating sub-agent with task type '${validatedInput.task_type}': ${profile.description}`
                );
                logger.debug(`Allowed tools: ${profile.allowedTools.join(', ')}`);

                // Create sub-agent session with parent context
                const session = await sessionManager.createSession(undefined, {
                    parentSessionId: parentSessionId || 'unknown',
                    depth: parentDepth,
                });
                subAgentSessionId = session.id;

                logger.info(
                    `Spawned sub-agent session ${session.id} (depth: ${parentDepth + 1}) for task: ${validatedInput.description}`
                );

                // TODO: Apply tool scoping
                // Currently sub-agent has full tool access. To implement scoping:
                // 1. Create ScopedToolManager with profile
                // 2. Modify ChatSession to accept optional toolManager override
                // 3. Pass scoped tool manager when creating sub-agent session
                logger.warn(
                    `Sub-agent has full tool access - tool scoping not yet implemented (needs ChatSession refactoring)`
                );

                // Build the prompt with context if provided
                let fullPrompt = validatedInput.prompt;
                if (validatedInput.context) {
                    fullPrompt += `\n\nContext:\n${JSON.stringify(validatedInput.context, null, 2)}`;
                }

                // Execute the task in the sub-agent session
                const result = await session.run(fullPrompt);

                // Calculate duration
                const duration = Date.now() - startTime;

                logger.info(
                    `Sub-agent task "${validatedInput.description}" completed successfully in ${duration}ms`
                );

                // Return results
                return {
                    result,
                    duration,
                    task_type: validatedInput.task_type,
                };
            } catch (error) {
                const duration = Date.now() - startTime;
                const errorMessage =
                    error instanceof Error ? error.message : 'Unknown error occurred';

                logger.error(
                    `Sub-agent task "${validatedInput.description}" failed after ${duration}ms: ${errorMessage}`
                );

                // Return error as result (don't throw to allow parent to handle gracefully)
                return {
                    result: `Task failed: ${errorMessage}`,
                    duration,
                    error: errorMessage,
                    task_type: validatedInput.task_type,
                };
            } finally {
                // ALWAYS cleanup sub-agent session, even on error
                if (subAgentSessionId) {
                    try {
                        await sessionManager.deleteSession(subAgentSessionId);
                        logger.debug(`Cleaned up sub-agent session: ${subAgentSessionId}`);
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
