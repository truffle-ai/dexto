# CLI Impact & Tasks

## What changes for the CLI?
- Starts a Hono app instead of Express when serving the API/WebUI.
- Keeps the interactive REPL but shares the same `DextoAgent` instance and logger with the HTTP layer.
- Moves Node-specific utilities (path detection, execution context, `.dexto` helpers) from `@dexto/core` into CLI utilities.
- Uses `createLoggerFromConfig` to honour YAML/env logging settings.

## Tasks
1. **Utility migration**
   - Create `packages/cli/src/utils/runtime.ts` containing `getDextoPath`, `getDextoEnvPath`, `getExecutionContext`, etc.
   - Update all CLI imports to use the new module.
   - Remove these utilities from `@dexto/core`; adjust any server package references accordingly.

2. **Logger integration**
   - Add `packages/cli/src/utils/logging.ts` implementing `createLoggerFromConfig`.
   - When constructing `DextoAgent`, pass the logger built from YAML/config.
   - Reuse the logger when creating the Hono runtime context.

3. **API server swap**
   - Replace Express bootstrap with:
     ```ts
     const contextFactory = createRuntimeContextFactory({ agentFactory, logger });
     const app = createDextoApp(contextFactory);
     const server = createNodeAdapter(app);
     ```
   - Update WebSocket wiring to use the Hono hub.
   - Keep redaction middleware by porting the logic to Hono middleware.

4. **Commands**
   - Session commands already moved into interactive commands (`/session ...`). Ensure they continue to interact with the agent directly.
   - Review CLI flags: `--new-session`, logging flags, etc., and update documentation.

5. **Tests**
   - Adjust CLI integration tests to work with the Hono server (e.g., hitting `/api/*` endpoints during tests).
   - Ensure REPL flows still function (mock IO or reuse existing tests).

6. **Docs**
   - Update CLI README to reflect Hono-based server, new logging configuration, and removal of Express-specific instructions.

## Considerations
- Keep Express code on a temporary branch until Hono deployment is confirmed stable.
- Ensure Windows path handling continues to work when moving utilities.
- Evaluate whether CLI should expose a command to print effective logging configuration for debugging.
