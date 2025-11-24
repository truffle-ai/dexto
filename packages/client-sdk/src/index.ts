/**
 * Dexto Client SDK
 * Lightweight type-safe client for Dexto API built on Hono's typed client
 */

// Core client
export { createDextoClient } from './client.js';

// SSE streaming
export { stream, createStream, createMessageStream, SSEError } from './streaming.js';
export type { SSEEvent, MessageStreamEvent } from './streaming.js';

// Client configuration
export type { ClientConfig } from './types.js';

// Server types for advanced usage
export type { AppType } from '@dexto/server';
