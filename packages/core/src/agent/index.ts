export { DextoAgent } from './DextoAgent.js';
export {
    AgentConfigSchema,
    AgentCardSchema,
    SecuritySchemeSchema,
    type AgentCard,
    type ValidatedAgentCard,
} from './schemas.js';
export { type ValidatedAgentConfig, type AgentConfig } from './schemas.js';
export { createAgentCard } from './agentCard.js';
export * from './errors.js';
export * from './error-codes.js';

// New generate/stream API types
export type {
    GenerateOptions,
    GenerateResponse,
    StreamOptions,
    AgentToolCall,
    // Re-exported from other modules for convenience
    ImageInput,
    FileInput,
    TokenUsage,
} from './types.js';

// Stream events are now core AgentEvents (exported from events module)
export type { StreamingEvent, StreamingEventName, STREAMING_EVENTS } from '../events/index.js';
