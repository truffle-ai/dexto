/**
 * Agent Spawner Tool Provider
 *
 * Enables agents to spawn sub-agents for task delegation.
 */

// Main provider export
export { agentSpawnerToolsProvider } from './tool-provider.js';

// Configuration types
export { AgentSpawnerConfigSchema } from './schemas.js';
export type { AgentSpawnerConfig } from './schemas.js';

// Service for advanced usage
export { RuntimeService } from './runtime-service.js';

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
