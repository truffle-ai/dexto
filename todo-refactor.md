# Migration Progress: Decoupling Filesystem & VCS from Core

## Phase 1: Establish the New Home (@dexto/agent-management)
- [x] Sync missing worktree logic to `packages/agent-management/src/utils/path.ts`
- [x] Update `getDextoEnvPath` in `agent-management` with logger parameter
- [x] Re-export `getWorktreeContext` in `packages/agent-management/src/utils/execution-context.ts`
- [x] Move `packages/core/src/vcs` to `packages/agent-management/src/vcs`
- [x] Update internal imports within the moved `vcs` module
- [x] Verify Phase 1 (Build & Unit Tests)

## Phase 2: Redirect CLI & TUI Consumers
- [ ] Update `packages/cli/src/` imports to use `@dexto/agent-management`
- [ ] Update `packages/tui/src/` imports to use `@dexto/agent-management`
- [ ] Verify Phase 2 (CLI Build)

## Phase 3: Decouple Core Internals (Dependency Injection)
- [ ] Create `core/src/config/paths.ts`
- [ ] Refactor `utils/api-key-resolver.ts` to use `CorePaths`
- [ ] Refactor `llm/registry/auto-update.ts` to use `CorePaths`
- [ ] Refactor `llm/providers/codex-app-server.ts` to use `CorePaths`
- [ ] Refactor `llm/providers/local/node-llama-provider.ts` to use `CorePaths`
- [ ] Refactor `llm/providers/openrouter-model-registry.ts` with late-binding initializer
- [ ] Inject paths in `packages/cli/src/index-main.ts` at startup
- [ ] Verify Phase 3 (Core & CLI interaction)

## Phase 4: Clean Up Core
- [ ] Remove `vcs` module from `core`
- [ ] Delete `packages/core/src/utils/path.ts`
- [ ] Delete `packages/core/src/utils/execution-context.ts`
- [ ] Remove dead exports from `core/src/index.ts` and `core/src/utils/index.ts`
- [ ] Verify Phase 4 (Final Build)

## Phase 5: Final Validation
- [ ] Run full project quality checks (`scripts/quality-checks.sh`)
- [ ] Manual verification of CLI context detection
