/**
 * Agent Spawner Tool Types
 *
 * Type definitions for tool inputs and outputs.
 */

/**
 * Output from spawn_agent tool
 */
export interface SpawnAgentOutput {
    /** Whether the task completed successfully */
    success: boolean;

    /** Final response from the sub-agent */
    response?: string;

    /** Error message if the task failed */
    error?: string;

    /** Warning message (e.g., when fallback LLM was used) */
    warning?: string;
}
