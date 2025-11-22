import { hc } from 'hono/client';
import type { AppType } from '@dexto/server';
import type { ClientConfig } from './types.js';

/**
 * Create a type-safe Dexto client using Hono's typed client
 *
 * @example
 * ```typescript
 * const client = createDextoClient({
 *   baseUrl: 'http://localhost:3001',
 *   apiKey: 'optional-api-key'
 * });
 *
 * // Synchronous message
 * const res = await client.api['message-sync'].$post({
 *   json: { message: 'Hello', sessionId: 'session-123' }
 * });
 * const data = await res.json();
 *
 * // Streaming message
 * const streamRes = await client.api['message-stream'].$post({
 *   json: { message: 'Hello', sessionId: 'session-123' }
 * });
 *
 * // Use EventStreamClient to parse SSE
 * import { EventStreamClient } from '@dexto/client-sdk';
 * const sseClient = new EventStreamClient();
 * const stream = await sseClient.connectFromResponse(streamRes);
 * for await (const event of stream) {
 *   console.log(event.event, JSON.parse(event.data));
 * }
 * ```
 */
export function createDextoClient(config: ClientConfig) {
    const options: { headers?: Record<string, string> } = {};

    if (config.apiKey) {
        options.headers = {
            Authorization: `Bearer ${config.apiKey}`,
        };
    }

    // Create Hono typed client with AppType for full type safety
    const client = hc<AppType>(config.baseUrl, options);

    return client;
}

/**
 * Type helper to get the inferred client type
 */
export type DextoClient = ReturnType<typeof createDextoClient>;
