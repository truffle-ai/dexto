# Bun Migration (Package Manager + Runtime) + Native TypeScript Runtime

Last updated: 2026-02-17

## Goals

1. **Bun for everything** in this monorepo:
   - **Package manager:** `bun install`, `bun add`, `bun run …`
   - **Runtime:** `bun …` for the CLI/server/dev scripts (no `node`/`pnpm` required for day-to-day work)
2. **Native TypeScript runtime** for user customization:
   - Enable TS-first extensions in layered `.dexto` locations, especially `~/.dexto/…`
   - Support TS-defined **images**, and (future) TS-defined **plugins / storage / compaction / hooks**
3. Reduce/avoid native Node add-on pain:
   - Prefer Bun built-ins (notably SQLite) over Node ABI-sensitive modules.

## Non-goals (for the first working milestone)

- Rewriting every example app to Bun (but we should keep them runnable).
- Switching the test framework from Vitest to `bun test` (we can run Vitest under Bun).
- Publishing strategy changes for npm (but we should keep packages publishable).

## Status (this worktree)

As of 2026-02-17 in `~/Projects/dexto-bun-migration`:

- Root workspace is Bun-based (`packageManager: bun@1.2.9`) with `bun.lock`.
- Repo scripts and entrypoints have been moved off hard `node`/`pnpm` invocations where it mattered for runtime.
- SQLite persistence under Bun uses **`bun:sqlite`** (no `better-sqlite3` ABI dependency for the Bun runtime path).
- `bun run build`, `bun run typecheck`, and `bun run test` are green.

Version note:
- **Current pinned Bun:** `1.2.9` (known-good in this worktree)
- **Latest Bun (upstream):** `1.3.9` (release 2026-02-08) — we’re intentionally staying on `1.2.9` during migration.

---

## Why Bun runtime (not “package manager only”)

### If Bun is **package manager only** and Node remains the runtime

You *can* install dependencies into `~/.dexto/plugins`, `~/.dexto/images`, etc. and load **built JS** by:
- importing via a **file URL** to the entry file, or
- resolving the package entry via Node resolution helpers and then importing.

But **native TypeScript at runtime is not solved**:
- Node cannot execute `.ts`/`.tsx` without a loader (e.g. `tsx`, `ts-node`, custom `--loader`).
- This leaks into every extension story (plugins/images/compaction/storage): either “compile first” or “bring a loader”.

### If Bun is also the **runtime**

- Bun can execute TypeScript directly (no `tsx` loader required).
- Bun supports the NodeNext TypeScript convention of **using `.js` in TS import specifiers**; Bun resolves it to the `.ts` source at runtime. (Verified in this repo by importing `./packages/core/src/utils/path.js` successfully under Bun.)

**Conclusion:** for “native TS in `~/.dexto`”, we should commit to **Bun runtime** for Dexto.

---

## Repo-specific migration surface area

### 1) Workspace + lockfiles

- Root `package.json` must include `workspaces` (Bun uses this; `pnpm-workspace.yaml` becomes legacy).
- Add Bun lockfile (`bun.lock` text is fine for review/merge conflicts).
- Keep `pnpm-lock.yaml` temporarily if you want a rollback path, but treat Bun as source-of-truth once CI switches.

### 2) Scripts / entrypoints

Targets:
- No hard `node …` calls in `package.json` scripts or repo scripts.
- Prefer `bun …` for running TS scripts (`scripts/*.ts`, `packages/*/scripts/*.ts`).
- Prefer `bun x …` when executing package CLIs (e.g. `vite`, `turbo`, `tsup`, `tsc`) if you want to eliminate reliance on Node shebangs in `node_modules/.bin`.

### 3) Native dependency audit (actual deps in this repo)

Hard lessons / current reality:
- **`better-sqlite3`** (Node native addon) is ABI-sensitive and fails under Bun unless compiled against Bun’s Node ABI compatibility (Bun v1.2.9 reports `NODE_MODULE_VERSION 127`).
- Build tooling commonly includes native pieces:
  - `esbuild`
  - `@tailwindcss/oxide`

Also relevant to *this repo’s* Bun runtime story:
- **Local model support uses a native addon**: `node-llama-cpp` is installed on-demand into `~/.dexto/deps` via `npm install node-llama-cpp` (today). If we want “Bun runtime, no Node required”, we need an explicit strategy for this (see Phase 1.5 + Known risks below).
- Bun supports **Node-API** for many native addons, but this is not universal; ABI-sensitive addons are a recurring risk. Prefer Bun built-ins (like `bun:sqlite`) or pure JS when possible.

Bun-specific knobs:
- `trustedDependencies` in root `package.json` + `bun pm trust …`
- `bun pm untrusted` to detect blocked lifecycle scripts

Current repo state to plan around:
- `bun pm untrusted` reports blocked postinstalls for:
  - `core-js` (runs `node -e …`)
  - `protobufjs` (runs `node scripts/postinstall`)
  These are blocked by default. If we ever decide to trust them, note they call `node` explicitly.

Implication:
- If we trust packages whose scripts explicitly invoke `node`, then **Node becomes a hidden dependency** even if we run Dexto under Bun.
- If we leave them blocked, we need to confirm nothing relies on their postinstall side effects (build/test currently succeeds with them blocked).

### 4) Images + the “image store” vs `~/.dexto` as a Bun package

Current implementation (today):
- Image installation uses `npm pack` + `npm install` into a temp dir, then moves into the image store.
- Image resolution imports the store’s **entry file URL** or falls back to `import('@scope/pkg')` (host resolution).

Migration direction (what we want):
- With Bun runtime, we can plausibly **de-emphasize or replace** the image store:
  - Make `~/.dexto` a real Bun package (has `package.json`, `node_modules/`)
  - Install images (and other extension packages) there via `bun add`
  - Resolve and import images/extensions from that root deterministically

Tradeoff:
- The current image store supports “multiple installed versions + active version”.
- A single Bun package root naturally supports “one resolved version at a time” via semver ranges in `package.json`.
  - If we still need multi-version switching, we’d implement it via multiple roots (e.g. `~/.dexto/images/<id>@<ver>/package.json`) or by keeping a registry + reinstall step.

---

## Phased plan

### Phase 0 — Working Bun baseline (monorepo)

- Set root `packageManager` to the Bun version we support (pin, and keep `engines.bun`).
- Ensure workspaces are declared in root `package.json`.
- Produce `bun.lock` and make `bun install` succeed from a clean checkout.
- Convert repo scripts/entrypoints to Bun:
  - Replace `node …` invocations with `bun …`
  - Replace `pnpm …` invocations with `bun …` (even if Bun auto-rewrites, keep scripts explicit)

Acceptance:
- `bun install`
- `bun run build`
- `bun run typecheck`
- `bun --cwd packages/cli run start -- --help`

### Phase 1 — Replace SQLite native addon with Bun SQLite

Why:
- `better-sqlite3` is the primary “Bun runtime blocker” in this repo.

Approach:
- Use Bun’s built-in `bun:sqlite` for the SQLite database store.
- Keep SQL schema + behavior the same.
- Make TypeScript happy by providing a local module declaration for `bun:sqlite` (so DTS/typecheck works in the monorepo).

Acceptance:
- Storage opens/creates the SQLite file and performs CRUD/list operations under Bun.
- CLI commands that touch persistence do not trigger any `better-sqlite3` ABI error under Bun.

### Phase 1.5 — Remove remaining pnpm/npm assumptions (repo + CLI UX)

This repo still contains **behavior and strings** that assume pnpm/npm in a few key places:
- Image store installer uses `npm pack` + `npm install` (tests mock npm).
- Local model setup installs `node-llama-cpp` via `npm install` into `~/.dexto/deps`.
- Some scaffolding/templates/help text prints `pnpm …` / `npm …` instructions.
- The “install-global-cli” dev script uses `npx`/`npm` to simulate user installs.
- MCP preset registry data and docs frequently use `npx` as the default command (consider switching to `bunx` if we want “no npm” end-to-end).

Acceptance:
- Running normal CLI flows never requires pnpm.
- Any remaining npm usage is either removed or explicitly documented as “requires Node/npm” (with a Bun-first alternative).

### Phase 2 — Native TS extensions in layered `.dexto` roots

Existing layering already in repo:
- Project-local `.dexto/…` paths
- Global `~/.dexto/…` paths

What “native TS extensions” should mean:
- A user can drop TS modules under `~/.dexto/…` (or install a package there) and Dexto can import them directly under Bun.
- These extensions can define:
  - images (today)
  - future: tool providers, storage backends, compaction strategies, hooks

Recommended resolution model under Bun:
1. Define one or more **extension roots**:
   - `~/.dexto` (global)
   - `<project>/.dexto` (project)
   - `<repo>/.dexto` (dev mode in-source)
2. Each extension root may be a Bun package root (optional):
   - `package.json` + `node_modules/`
3. To resolve a specifier (image/plugin) from a root:
   - Use `Bun.resolveSync(specifier, rootPackageJsonPath)` (or an equivalent Bun resolution strategy)
   - `import(pathToFileURL(resolvedPath).href)`
4. Merge/override rules:
   - Project root overrides global root (and repo dev root overrides both when in dev mode).

Acceptance:
- A TS image module located in `~/.dexto` can be imported and validated without a build step.
- No `tsx` loader dependency for this path when running under Bun.

### Phase 3 — Deprecate or redesign the image store (align with “DEXTO_DOTDEXTO” intent)

Intent:
- If `~/.dexto` becomes a Bun package root that can contain images, we likely don’t need:
  - separate `~/.dexto/images/packages/...` staging
  - `registry.json` tracking of active versions (or at least we can simplify it)

Options:
- **Option A (minimal change):** keep image store but replace `npm pack/install` with `bun pm pack` + `bun add`/`bun install` equivalents.
- **Option B (preferred):** treat `~/.dexto` as the canonical package root:
  - images become dependencies in `~/.dexto/package.json`
  - “activate version” becomes updating a dependency range + reinstall
  - “local image” becomes `file:` dependency or a linked workspace root

Acceptance:
- Installing/activating images uses Bun-native mechanisms.
- TS image modules can live in the layered `.dexto` roots and load natively under Bun runtime.

### Phase 4 — CI + docs

- Update CI to use Bun for install/build/typecheck/test.
- Update docs that mention pnpm/npm for core workflows.
- Document `trustedDependencies` and the `bun pm untrusted` workflow.

---

## Known risks / things to validate early

- **Lifecycle scripts**: `core-js` and `protobufjs` postinstalls are blocked by default and call `node`.
  - Prefer leaving them blocked unless/until a concrete breakage requires trusting them.
- **TypeScript version drift** under Bun:
  - Bun will respect `bun.lock`; ensure we commit it and keep dependency ranges intentional.
- **“NodeNext + .js specifiers”**:
  - Verified Bun resolves `.js` specifiers to `.ts` sources (good for running TS directly).
  - Still validate this for extension packages in `~/.dexto` (same convention should work).
- **Node native addons (esp. for local models):**
  - Prefer Bun built-ins or pure JS where possible.
  - If a feature requires a native addon, validate it under Bun specifically (Node ABI differences are common).
