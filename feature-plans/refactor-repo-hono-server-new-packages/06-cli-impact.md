# CLI Impact & Tasks

## What changes for the CLI?
- Boots a Hono app + Node bridge instead of Express when serving the API/WebUI.
- Keeps the interactive REPL but shares the same `DextoAgent` instance and injected logger with the HTTP layer.
- Moves Node-specific utilities (path detection, execution context, preferences loader, `.dexto` helpers) from `@dexto/core` into CLI utilities that run before the agent is constructed.
- Normalises registry macros (`@agent_dir`, etc.) and resolves filesystem paths so the runtime config passed to `DextoAgent` is self-contained.

## Tasks
1. **Utility migration**
   - Create `packages/cli/src/utils/runtime.ts` containing `resolveDextoPath`, `detectExecutionContext`, `.dexto` directory helpers, and registry path expansion helpers (`expandAgentDirMacros`).
   - Move preferences loader/saver into `packages/cli/src/utils/preferences.ts`.
   - Update CLI imports to use the new modules.
   - Update FileContributor + docs to rely on `@agent_dir` placeholders rather than raw config paths.

2. **Logger integration**
   - Implement `packages/cli/src/utils/logging.ts` (`createLoggerFromConfig`).
   - When constructing `DextoAgent`, pass `{ logger }` only; config already contains resolved paths.
   - Reuse the logger when creating the Node bridge + websocket hub.

3. **API server swap**
   - Replace Express bootstrap with:
     ```ts
     const config = await loadAgentConfig(...);
     const logger = createLoggerFromConfig(config.logging);
     const agent = new DextoAgent(config, { logger });
     const app = createDextoApp(agent);
     const { server, hub } = createNodeServer(app, { logger, agent });
     server.listen(port);
     ```
   - Ensure redaction middleware and error handling move to Hono equivalents.

4. **WebSocket & MCP wiring**
   - Use `createWebsocketHub` from the server package instead of the bespoke subscriber.
   - Delegate MCP HTTP/SSE handling to the bridge-provided helpers.

5. **Commands**
   - Session commands continue to interact with the shared agent instance.
   - Review CLI flags (`--new-session`, logging flags) and update docs as needed.

6. **Preferences + setup flows**
   - Update setup/registry utilities to use the relocated preferences helpers.
   - Ensure error messaging still points to the correct preference file (now resolved via CLI runtime helper).

7. **Tests**
   - Adjust CLI integration tests to target the Hono app + Node bridge (supertest on the server, ws for websocket flows).
   - Update unit tests that mocked Express-specific modules.

8. **Docs**
   - Update CLI README to reflect Hono-based server, new logging configuration, registry macros, and FileContributor path handling.

## Considerations
- Windows path handling stays centralised in `resolveDextoPath`.
- CLI should expose a debug command or flag to print the effective logging + path configuration after the refactor.
