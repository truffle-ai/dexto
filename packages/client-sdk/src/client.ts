import { hc } from 'hono/client';
import type { AppType } from '@dexto/server';
import type { ClientConfig } from './types.js';

/**
 * Create a type-safe Dexto client using Hono's typed client
 *
 * @example
 * ```typescript
 * import { createDextoClient } from '@dexto/client-sdk';
 *
 * const client = createDextoClient({
 *   baseUrl: 'http://localhost:3001',
 *   apiKey: 'optional-api-key'
 * });
 *
 * // Create a session
 * const session = await client.api.sessions.$post({
 *   json: { sessionId: 'my-session' }
 * });
 *
 * // Send a synchronous message
 * const response = await client.api['message-sync'].$post({
 *   json: { message: 'Hello!', sessionId: 'my-session' }
 * });
 * const { response: text } = await response.json();
 *
 * // Search messages
 * const searchResults = await client.api.search.messages.$get({
 *   query: { q: 'hello', limit: 10 }
 * });
 *
 * // Streaming responses with SSE
 * const stream = await client.api['message-stream'].$post({
 *   json: { message: 'Tell me a story', sessionId: 'my-session' }
 * });
 *
 * // Parse SSE stream
 * const reader = stream.body?.getReader();
 * const decoder = new TextDecoder();
 * while (reader) {
 *   const { done, value } = await reader.read();
 *   if (done) break;
 *   console.log(decoder.decode(value));
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

export * from './streaming.js';

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
