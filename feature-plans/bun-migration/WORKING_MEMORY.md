# Working Memory — Bun Migration

> This file is a live scratchpad for the Bun migration.
> Update it after completing each task. Read it before starting work.

---

## Current Task

**Task:** PR 1 — Bun migration (repo) + CLI packaging parity  
**Status:** In progress  
**Worktree:** `~/Projects/dexto-bun-migration`  
**Pinned Bun:** `1.3.5`

### Plan

- Keep the monorepo Bun-first for local dev + CI (`bun install`, `bun run …`).
- Ensure end users can install `dexto` via npm without requiring Bun installed by shipping **Bun-compiled binaries** + an **npm wrapper**.
- Ensure CI/release workflows build binaries before publishing.
- Validate with:
  - `bun run lint`
  - `bun run typecheck`
  - `bun run test:unit`
  - `bun run build`
  - `bun scripts/build-cli-binaries.ts --single`
  - `node packages/dexto/bin/dexto.cjs --help`

### Notes / Findings

- The published package is now `dexto` (npm wrapper). The internal monorepo CLI package is `@dexto/cli` (private) to avoid name collision.
- The wrapper selects an optional, platform-specific binary package:
  - `dexto-darwin-arm64`, `dexto-darwin-x64`
  - `dexto-linux-arm64`, `dexto-linux-arm64-musl`
  - `dexto-linux-x64`, `dexto-linux-x64-musl`
  - `dexto-win32-x64`
- The wrapper sets:
  - `DEXTO_PACKAGE_ROOT` → used by the runtime to find bundled assets on disk
  - `DEXTO_CLI_VERSION` → avoids reading `package.json` inside compiled/bunfs contexts
- Compiled-binary compatibility required removing top-level `package.json` reads in runtime entrypoints and adding env/define-based version resolution.
- Bun CLI nuance: use `bun run --cwd <dir> <script>`. `bun --cwd <dir> run <script>` prints Bun help and doesn’t run the script.
- Cross-target compilation works: `bun scripts/build-cli-binaries.ts` successfully builds all 7 targets from macOS (downloads target toolchains as needed).

### Recent commits (this worktree)

- `930bdff6` add `dexto` npm wrapper + platform binary packages + compiled-runtime fixes + `scripts/build-cli-binaries.ts`
- `10f5a6c1` fix review items (setup-bun v2, SQLite updated_at seconds, unlink logging, safer spawn defaults, npm update command)
- `56ddce7a` fix unit tests for npm update command
- `1017fece` switch local model dependency install to `npm install` (no external Bun prerequisite)

---

## Current State (as of 2026-02-18)

- Bun pinned: `1.3.5` (`package.json#packageManager`, `engines.bun`, workflows)
- Verified green locally:
  - `bun run lint`
  - `bun run typecheck`
  - `bun run test:unit` (after updating expectations for npm update command)
  - `bun run build`
- Verified packaging:
  - `bun scripts/build-cli-binaries.ts --single`
  - `bun scripts/build-cli-binaries.ts` (all targets)
  - `node packages/dexto/bin/dexto.cjs --version` / `--help`

---

## Key Decisions

- **PR 1 scope:** migrate pnpm→Bun for repo workflows + CI/release, with no feature changes.
- **Distribution:** ship Bun runtime as a compiled binary in platform packages, launched by an npm wrapper package (`dexto`) so end users don’t need Bun installed.
- **PR 2 scope (deferred):** native TS layering in `~/.dexto` (plugins/storage/compaction) + any image-store redesign.

---

## Open Questions / Blockers

1. **Release workflow:** ensure `changeset:publish` builds platform binaries (and bundles runtime assets) before publishing `dexto-*` packages.
2. **Local “production-like install” script:** `bun run install-cli(-fast)` must build binaries (at least `--single`) before publishing to verdaccio.
3. **Local models:** validate the end-to-end flow after switching `node-llama-cpp` install to `npm install` (native build toolchain, import works, and a real GGUF prompt works).
4. **Scaffolding parity:** scaffolding commands outside `dexto-source` may still depend on unpublished `@dexto/*` packages (owner publish is a merge blocker).

---

## Completed Tasks (log)

- Implemented npm wrapper + platform binary package structure and compiled-runtime compatibility.
- Addressed PR review feedback (workflow consistency, SQLite timestamp correctness, safer process execution, unlink logging).
- Verified key workflows locally (lint/typecheck/unit tests/build) and validated compiled binary packaging.
