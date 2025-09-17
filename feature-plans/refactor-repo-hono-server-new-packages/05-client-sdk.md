# Client SDK Alignment

## Goals
- Rebuild `@dexto/client-sdk` as a thin wrapper over the generated typed client (`createTypedClient`).
- Drop bespoke fetch/websocket implementations from the previous dist-only package.
- Keep bundle size small and environment agnostic (browser, React Native, Node).

## Changes
1. **Fresh source tree**
   - Replace the existing dist-only package with a TypeScript source layout (`src/`), tsup build, and modern exports map.
2. **Typed client integration**
   ```ts
   import { createTypedClient } from '@dexto/server/hono';

   export class DextoClient {
     private readonly client;
     constructor(private readonly config: ClientConfig) {
       this.client = createTypedClient(config.baseUrl, { headers: this.buildHeaders() });
     }

     async sendMessage(input: MessageInput) {
       const response = await this.client.api['message-sync'].$post({ json: input });
       return response.json();
     }
     // Additional helpers wrap typed client methods + transform responses.
   }
   ```
3. **WebSocket helper**
   - Reuse the contract exposed by `createWebsocketHub`; the SDK listens on `/ws`, handles tool confirmations/events, and exposes an event emitter API.
4. **Retry/backoff**
   - Keep exponential backoff + timeout helpers, but layer them on top of the typed client (no custom fetch wrapper).
5. **Schema types**
   - Import shared types from `@dexto/core` (`SessionMetadata`, `SearchResponse`, `MessageInput`).
6. **Build output**
   - `tsup` config producing ESM + CJS with sourcemaps, TS declarations, and side-effect metadata.
7. **Exports**
   - `index.ts` re-exports `DextoClient`, config types, event enums, and helper utilities.

## Testing
- Integration tests spin up the Hono app via the Node bridge in-process and drive the SDK end-to-end.
- Browser bundle smoke test ensures no Node polyfills are required (tree-shaking removes Winston and Node bridge code).
- WebSocket tests verify event subscriptions (session/agent events) behave as before.

## Documentation
- Update README/example usage to reflect the new SDK surface.
- Include guidance for hosted scenarios (API keys, base URL configuration, websocket usage).

## Future extensions
- Auto-generated client documentation from Hono route metadata (OpenAPI) to keep SDK docs in sync.
- Optional streaming support using `ReadableStream`/Server-Sent Events if needed.
