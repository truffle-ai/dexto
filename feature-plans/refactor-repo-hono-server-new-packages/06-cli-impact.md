# CLI Impact & Tasks

## What changes for the CLI?
- Boots a Hono app + Node bridge instead of Express when serving the API/WebUI.
- Keeps the interactive REPL but shares the same `DextoAgent` instance and injected logger with the HTTP layer.
- Moves Node-specific utilities (path detection, execution context, preferences loader, `.dexto` helpers) from `@dexto/core` into CLI utilities that run before the agent is constructed.
- Normalises runtime config so file-based contributors already contain absolute paths; core no longer depends on config directory lookups.

## Tasks
1. **Utility migration & config normalisation**
   - Create `packages/cli/src/utils/runtime.ts` containing `resolveDextoPath`, `detectExecutionContext`, `.dexto` directory helpers, and config normalisers that convert relative file paths to absolutes before passing them to the agent.
   - Move preferences loader/saver into `packages/cli/src/utils/preferences.ts`.
   - Update CLI imports to use the new modules.
   - Introduce a `normaliseFileContributors` helper that resolves contributor paths relative to the config file (or project root) and expand registry macros.

2. **Logger & FileContributor refactor**
   - Implement `packages/cli/src/utils/logging.ts` (`createLoggerFromConfig`) and inject the logger when constructing `DextoAgent`.
   - Drop the singleton `logger` imports in CLI/core.
   - Update FileContributor defaults + docs so contributors no longer require `configDir`; rely on the normalised absolute paths prepared in task 1.

3. **API server swap**
   - Replace Express bootstrap with Hono app + Node bridge.
   - Ensure redaction middleware and error handling move to Hono equivalents.

4. **WebSocket & MCP wiring**
   - Use `createWebsocketHub` from the server package instead of the bespoke subscriber.
   - Delegate MCP HTTP/SSE handling to the bridge-provided helpers.

5. **Commands & setup flows**
   - Session commands continue to interact with the shared agent instance.
   - Update setup/registry utilities to use the relocated preferences helpers.
   - Ensure error messaging still points to the correct preference file (resolved before agent creation).

6. **Tests**
   - Adjust CLI integration tests to target the Hono app + Node bridge (supertest on the server, ws for websocket flows).
   - Update unit tests that mocked Express-specific modules or config-path helpers.

7. **Docs**
   - Update CLI README to reflect Hono-based server, new logging configuration, and simplified FileContributor path handling.

## Considerations
- Windows path handling stays centralised in `resolveDextoPath`.
- CLI should expose a debug command or flag to print the effective logging + path configuration after the refactor.
