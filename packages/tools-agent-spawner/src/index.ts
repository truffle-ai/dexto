/**
 * @dexto/tools-agent-spawner
 *
 * Agent spawner tools provider for Dexto agents.
 * Enables spawning and managing sub-agents for task delegation.
 */

// Main provider export
export { agentSpawnerToolsProvider } from './tool-provider.js';

// Configuration types
export { AgentSpawnerConfigSchema } from './schemas.js';
export type { AgentSpawnerConfig } from './schemas.js';

// Service for advanced usage
export { RuntimeService } from './runtime-service.js';

// Tool creators for custom integration
export { createSpawnAgentTool } from './spawn-agent-tool.js';
export { createDelegateTaskTool } from './delegate-task-tool.js';
export { createGetStatusTool } from './get-status-tool.js';
export { createListAgentsTool } from './list-agents-tool.js';
export { createStopAgentTool } from './stop-agent-tool.js';

// Input schemas for validation
export {
    SpawnAgentInputSchema,
    DelegateTaskInputSchema,
    GetAgentStatusInputSchema,
    StopAgentInputSchema,
    ListAgentsInputSchema,
} from './schemas.js';
export type {
    SpawnAgentInput,
    DelegateTaskInput,
    GetAgentStatusInput,
    StopAgentInput,
    ListAgentsInput,
} from './schemas.js';

// Output types
export type {
    SpawnAgentOutput,
    DelegateTaskOutput,
    GetAgentStatusOutput,
    ListAgentsOutput,
    StopAgentOutput,
} from './types.js';

// Error handling
export { AgentSpawnerError } from './errors.js';
export { AgentSpawnerErrorCode } from './error-codes.js';
