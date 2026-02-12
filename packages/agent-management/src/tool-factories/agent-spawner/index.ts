/**
 * Agent Spawner Tools Factory
 *
 * Enables agents to spawn sub-agents for task delegation.
 */

// Main factory export
export { agentSpawnerToolsFactory } from './factory.js';

// Configuration types
export { AgentSpawnerConfigSchema } from './schemas.js';
export type { AgentSpawnerConfig } from './schemas.js';

// Service for advanced usage
export { AgentSpawnerRuntime } from './runtime.js';

// Tool creator for custom integration
export { createSpawnAgentTool } from './spawn-agent-tool.js';

// Input schema for validation
export { SpawnAgentInputSchema } from './schemas.js';
export type { SpawnAgentInput } from './schemas.js';

// Output type
export type { SpawnAgentOutput } from './types.js';

// Error handling
export { AgentSpawnerError } from './errors.js';
export { AgentSpawnerErrorCode } from './error-codes.js';
