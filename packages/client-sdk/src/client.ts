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

    return hc<AppType>(config.baseUrl, options);
}

// Uncomment for testing in IDE
// const client1 = hc<AppType>('http://localhost:3001');
// let response1 = await client1.api.search.sessions.$get({
//     query: {
//         q: "poop"
//     }
// })
// const client2 = createDextoClient({
//     baseUrl: 'http://localhost:3001',
//     apiKey: 'optional-api-key'
// })

// let response2 = await client2.api.sessions.$post({
//     json: {
//         sessionId: 'session-123'
//     }
// })

// const body2 = await response2.json();
// console.log(body2.session.id);

// let response3 = await client2.health.$get();
// console.log(response3.ok);

export * from './streaming.js';

/**
 * Type alias for the Dexto client
 * Inferred from the createDextoClient return type
 */
export type DextoClient = ReturnType<typeof createDextoClient>;
