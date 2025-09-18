# Utility Migration Follow-up

## Current Status
- CLI-only runtime helpers (`env.ts`, `api-key-store.ts`, `port-utils.ts` and their tests) now live in `packages/cli/src/runtime/`.
- `packages/core/src/utils/index.ts` no longer re-exports those helpers.
- No wrapper modules remain in the runtime directory; helpers import `@dexto/core` directly.
- CLI type-check now covers test files via the updated `tsconfig.json` / `tsconfig.build.json` split.
- Preferences, agent resolver, registry, and the heavier path utilities are **still** in `@dexto/core`.

## Deferred Work (Phase 1)
1. **Preferences Runtime**
   - Move `packages/core/src/preferences/{loader.ts, schemas.ts, errors.ts, constants.ts}` and associated tests into `packages/cli/src/runtime/preferences/`.
   - Update CLI consumers (`cli/commands/setup.ts`, `cli/commands/list-agents.ts`, `cli/utils/setup-utils.ts`, registry code) to import from the runtime module.
   - Remove preference exports from `@dexto/core` once no longer used there.

2. **Agent Resolver & Registry**
   - Relocate `packages/core/src/config/agent-resolver.ts`, `packages/core/src/agent/registry/registry.ts`, and related helpers/tests into `packages/cli/src/runtime/registry/`.
   - Adjust CLI entry points (`packages/cli/src/index.ts`, install/uninstall/which commands) to consume the relocated utilities.
   - Ensure tests are updated (`agent-resolver.test.ts`, registry tests, CLI command tests).

3. **Config Normaliser**
   - Implement a runtime normaliser that resolves file contributor paths, registry macros, and storage defaults before instantiating `DextoAgent`.
   - Cover the normaliser with focused unit tests.

4. **Post-migration Cleanup**
   - After the above moves, prune any remaining filesystem exports from `@dexto/core/src/utils/index.ts`.
   - Run targeted suites (CLI runtime, registry, preferences) followed by a full `pnpm test` to confirm no regressions.

## Notes for the Next Agent
- Keep `DextoRuntimeError`, `ErrorScope`, and related enums in `@dexto/core`; the runtime modules should continue importing them when throwing typed errors.
- Preferences/registry migrations can be deferred again if higher-priority tasks arise, but revisit once the logger and server refactors begin.
- When introducing the config normaliser, make sure it plays nicely with existing docs/examples that call `loadAgentConfig` directly.
