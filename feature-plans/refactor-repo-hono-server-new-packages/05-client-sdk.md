# Client SDK Alignment

## Goals
- Make `@dexto/client-sdk` the primary consumer-facing API wrapper.
- Replace bespoke fetch logic with a typed client generated from the Hono app (`hc`).
- Keep bundle size small and environment-agnostic (browser, React Native, Node).

## Changes
1. **Use typed client**:
   ```ts
   import { createTypedClient } from '@dexto/server/hono';
   
   export class DextoClient {
     private readonly client = createTypedClient(this.config.baseUrl, { headers: this.headers });
     
     async sendMessage(input: MessageInput) {
       const response = await this.client.api['message-sync'].$post({ json: input });
       return response.json();
     }
     // Additional helpers wrap typed client methods.
   }
   ```
2. **WebSocket helper**: reuse `createWebsocketHub` protocol contract; the SDK listens on `/ws` and exposes an event emitter API.
3. **Retry/backoff**: keep a small wrapper around the typed client to provide exponential backoff/timeouts (logic already present in current SDK); ensure it’s pluggable.
4. **Schema types**: import shared types from `@dexto/core` where appropriate (`SessionMetadata`, `SearchResponse`).
5. **Build output**: tsup config producing ESM + CJS, minified with sourcemaps (see recommendations earlier).
6. **Exports**: `index.ts` re-exports `DextoClient`, client options, error helpers, event types.

## Testing
- Integration tests spin up the Hono app in-process (via `createDextoApp`, `createRuntimeContextFactory`) and run the SDK end-to-end.
- Browser bundle smoke test ensures no Node polyfills are required (check tree-shaking removes Winston).
- WebSocket tests verify event subscriptions (session/agent events) behave as before.

## Documentation
- Update README/example usage to show connecting to the new server endpoint.
- Provide guidance for hosted scenarios (API keys, base URL configuration).

## Future extensions
- Auto-generated client documentation from Hono route metadata (OpenAPI) to keep SDK docs in sync.
- Optional streaming support using `ReadableStream`/Server-Sent Events if needed.
