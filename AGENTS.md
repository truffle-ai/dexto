# Dexto Development Guidelines for AI Assistants

This repo is reviewed by automated agents (including CodeRabbit). This file is the source of truth for repo-wide conventions and review expectations.

**Package manager: Bun** (do not use pnpm/npm/yarn)

## Code Quality Requirements

Before completing significant tasks, prompt the user to ask if they want to run:

```bash
/quality-checks
```

This runs `scripts/quality-checks.sh` for build, tests, lint, and typecheck. See `.claude/commands/quality-checks.md`.

## General Rules

- Optimize for correctness. Use facts and code as the source of truth.
- Read relevant code before recommending changes. Prefer grep/glob + direct file references over assumptions.
- If something requires assumptions, state them and ask for confirmation.
- Don't communicate to the user via code comments. Comments are for future readers of the code, not for explaining decisions to the user.

## Stack Rules (important)

These rules are intended to prevent stack fragmentation and review churn.

### WebUI (`packages/webui`)

- Build tool: **Vite**
- Routing: **TanStack Router** (`@tanstack/react-router`). Do not introduce `react-router-dom` or other routing systems unless explicitly migrating.
- Server-state/data fetching: **TanStack Query** (`@tanstack/react-query`). Prefer it for request caching, invalidation, and async state.
- Client-side state: Zustand exists; prefer it only for genuinely client-only state (UI preferences, local toggles). Avoid duplicating server state into stores.

### Server (`packages/server`)

- HTTP API: **Hono** routes live in `packages/server/src/hono/routes/*.ts`.
- Error mapping middleware: `packages/server/src/hono/middleware/error.ts`.

### Core (`packages/core`)

- Core is the business logic layer. Keep policy, validation boundaries, and reusable services here.

### CLI (`packages/cli`)

- Entry point: `packages/cli/src/cli/index.ts`
- Static commands (e.g., `dexto init`, `dexto setup`): `packages/cli/src/cli/commands/`
- Interactive CLI commands (e.g., `/help`, `/compact`): `packages/cli/src/cli/commands/interactive-commands/`
- Ink-based UI components: `packages/cli/src/cli/ink-cli/`

### Other Important Packages

- **`@dexto/client-sdk`**: Lightweight type-safe client for the Dexto API (Hono-based). Use for external integrations.
- **`@dexto/agent-management`**: Agent registry, config discovery, preferences, and agent resolution logic.
- **`@dexto/analytics`**: Shared PostHog analytics utilities for CLI and WebUI (opt-in telemetry).
- **`@dexto/registry`**: Shared registry data (MCP server presets, etc.) for CLI and WebUI.
- **`@dexto/tools-*`**: Modular tool packages (`tools-filesystem`, `tools-process`, `tools-todo`, `tools-plan`). Each provides a tool provider that registers with the core tool registry.

### Images (`packages/image-*`)

Images are pre-configured bundles of providers, tools, and defaults for specific deployment targets. They use `defineImage()` from core.

- **`@dexto/image-local`**: Local development image with filesystem/process tools, SQLite storage.
- **`@dexto/image-bundler`**: Build tool for bundling images (`dexto-bundle` CLI).

Image definition files use the convention `dexto.image.ts` and register providers (blob stores, custom tools) as side-effects when imported.

### Adding New Packages

All `@dexto/*` packages use **fixed versioning** (shared version number).

When creating a new package:
1. Add the package name to the `fixed` array in `.changeset/config.json`
2. Set its `version` in `package.json` to match other packages (check `packages/core/package.json`)

## Avoiding Duplication (repo-wide)

**Before adding any new helper/utility/service:**
1. Search the codebase first (glob/grep for similar patterns).
2. Prefer extending existing code over creating new.
3. If new code is necessary, justify why existing code doesn't work.

This applies everywhere (core, server, cli, webui). Violations will be flagged in review.

## Architecture & Design Patterns

### API / Server Layer

- Routes should be thin wrappers around core capabilities (primarily `DextoAgent` + core services).
- Keep business logic out of routes; keep route code focused on:
  - request parsing/validation
  - calling core
  - mapping errors + returning responses
- `DextoAgent` class should also not have too much business logic; should call helper methods within services it owns.

### Service Initialization

- **Config file is source of truth**: Agent YAML files in `agents/` directory (e.g., `agents/coding-agent/coding-agent.yml`).
- **Override pattern for advanced use**: use `InitializeServicesOptions` only for top-level services (avoid wiring every internal dependency).
- **CLI Config Enrichment**: CLI adds per-agent paths (logs, database, blobs) via `enrichAgentConfig()` before agent initialization.
  - Source: `packages/agent-management/src/config/config-enrichment.ts`

### Execution Context Detection

Dexto infers its execution environment to enable context-aware defaults and path resolution. Use these utilities when behavior should differ based on how dexto is running.

**Context types:**
- `dexto-source`: Running within the dexto monorepo itself (development)
- `dexto-project`: Running in a project that has dexto as a dependency
- `global-cli`: Running as globally installed CLI or in a non-dexto project

**Key files:**
- `packages/core/src/utils/execution-context.ts` - Context detection
- `packages/core/src/utils/path.ts` - Context-aware path resolution
- `packages/cli/src/cli/utils/api-key-setup.ts` - Context-aware setup UX

## LLM Registry

Dexto’s supported models live in core and are primarily sourced from `models.dev`.

- **Registry source of truth:** `packages/core/src/llm/registry/index.ts` (consumes the generated snapshot + any manual overlays).
- **Generated snapshot:** `packages/core/src/llm/registry/models.generated.ts` (generated from `models.dev` via `scripts/sync-llm-registry.ts`).
  - Update: `bun run sync-llm-registry`
  - Verify clean repo (CI-style): `bun run sync-llm-registry:check`
- **Gateway transform validation:** `packages/core/src/llm/registry/index.test.ts` includes a full-sweep check that our native→OpenRouter ID transform still matches the committed OpenRouter catalog snapshot (runs in `bun run test`; catches naming drift like Anthropic dotted versions or Gemini `-001`).
- **Manual overlays / missing models:** `packages/core/src/llm/registry/models.manual.ts` (e.g. models missing capability metadata upstream).
- **Curation for UI/onboarding:** `packages/core/src/llm/curation-config.ts` (explicit curated model IDs; used by `/llm/catalog?scope=curated` and default pickers).
- **Runtime auto-update (Node-only):** `packages/core/src/llm/registry/auto-update.ts` caches a fetched registry at `~/.dexto/cache/llm-registry-models.json` (disable with `DEXTO_LLM_REGISTRY_DISABLE_FETCH=1`).
- **Dexto gateway provider:** `dexto` is not on `models.dev` (it’s an OpenRouter proxy), so its model list is maintained in `packages/core/src/llm/registry/index.ts`.

## Zod / Schema Design

- Always use `.strict()` for configuration objects (reject typos/unknown fields).
- Prefer `discriminatedUnion` over `union` for clearer errors.
- Describe fields with `.describe()` where it improves usability.
- Prefer sensible defaults via `.default()`.
- Use `superRefine` for cross-field validation.

Type extraction conventions (repo rule):
- Use `z.input<typeof Schema>` for raw/unvalidated input types.
- Use `z.output<typeof Schema>` for validated/output types.
- Do not use `z.infer` (lint-restricted).

## Result Pattern & Validation Boundary

### Core Principles

- **`DextoAgent` is the validation boundary**: public-facing methods validate inputs; internal layers can assume validated inputs.
- Internal validation helpers should return Result-style objects; public methods throw typed errors.

### Result Helpers

Use standardized helpers from: `packages/core/src/utils/result.ts`

- `ok(data, issues?)`
- `fail(issues)`
- `hasErrors(issues)`
- `splitIssues(issues)`
- `zodToIssues(zodError)`

## Error Handling

### Core Error Classes

- `DextoRuntimeError`: single runtime failure (I/O, network, invariant violation)
- `DextoValidationError`: multiple validation issues

### Rules

- Avoid `throw new Error()` in `packages/core`. Prefer typed errors.
- Non-core packages may use plain `Error` when a typed error is not available.
- Use module-specific **error factory** pattern for new modules.
  - Reference examples:
    - `packages/core/src/config/errors.ts`
    - `packages/core/src/logger/v2/errors.ts`
    - `packages/core/src/storage/errors.ts`
    - `packages/core/src/telemetry/errors.ts`
- **Exemption**: Build-time CLI tools and development tooling (bundlers, compilers, build scripts) are exempt from the strict `DextoRuntimeError`/`DextoValidationError` requirement. Plain `Error` is acceptable for build tool failures to align with standard build tool practices (tsc, esbuild, vite).

### Server/API error mapping

- Source of truth: `mapErrorTypeToStatus()` in `packages/server/src/hono/middleware/error.ts`

## Imports / ESM

- In `packages/core`, local relative imports must include `.js` in the TypeScript source for Node ESM output compatibility.
- Do not add `.js` to package imports (e.g. `zod`, `hono`, `@dexto/*`).

## OpenAPI Documentation

- Never directly edit `docs/static/openapi/openapi.json` (generated file).
- OpenAPI is generated from Hono route definitions in `packages/server/src/hono/routes/*.ts`.

Update process:
1. Modify route definitions / Zod schemas in `packages/server/src/hono/routes/*.ts`
2. Run `bun run sync-openapi-docs`
3. Verify the generated output includes your changes

## Logging

The repo contains logger v1 and logger v2 APIs (core). Prefer patterns compatible with structured logging.

- Prefer: `logger.info('Message', { contextKey: value })` (structured context as the second parameter where supported)
- Avoid: `logger.error('Failed:', err)` style extra-arg logging; it's ambiguous across logger versions/transports.
- Template literals are fine when interpolating values:
  - `logger.info(\`Server running at \${url}\`)`

Colors:
- Color formatting exists (chalk-based), but treat color choice as optional and primarily CLI-facing (don't encode “must use exact color X” rules in new code unless the existing subsystem already does).

Browser safety:
- `packages/core/src/logger/logger.ts` is Node-oriented (fs/path/winston). Be careful not to import Node-only runtime modules into `packages/webui` bundles. Prefer `import type` when consuming core types from the WebUI.

## TypeScript Guidelines

- Strict null safety: handle `null` / `undefined` explicitly.
- Avoid `any` across the repo.
  - Prefer `unknown` + type guards.
  - If `any` is unavoidable (third-party typing gaps / boundary code), keep the usage local and justify it.
- In tests, prefer `@ts-expect-error` over `as any` when intentionally testing invalid inputs.
- Avoid optional parameters, overload signatures, and “fallback” union types (e.g. `Service | (() => Service)`) unless there is a strong, unavoidable reason.
  - Prefer a single, required function signature.
  - Prefer a single `options` object (with defaults applied internally) over constructor overloads.
  - If runtime context is required, pass it explicitly rather than making it optional.
- Avoid non-null assertions (`!`) in production code. It is acceptable in tests when it improves clarity and the value is provably present.

## Module Organization

- Selective barrel strategy: only add `index.ts` at real public module boundaries.
- Prefer direct imports internally; avoid deep re-export chains.
- Avoid wildcard exports; prefer explicit named exports.
- Watch for mega barrels (>20 symbols or >10 files) and split if needed.

## Git / PR Standards

- Never use `git add .` or `git add -A`. Stage explicit files/paths only.
- Always inspect staged files before committing.
- Never amend commits (`git commit --amend`). Create new commits instead.
- Don't include AI-generated footers in commits/PRs.
- Keep commit messages technical and descriptive.

## Documentation Changes

- Always request user review before committing documentation changes.
- Never auto-commit documentation updates.
- Keep documentation user-focused; avoid exposing unnecessary internal complexity.

## Testing

Test types:
- Unit: `*.test.ts`
- Integration: `*.integration.test.ts`

Test location: Co-locate tests with source files (e.g., `foo.ts` → `foo.test.ts` in same directory).

Common commands:
- `bun run test`
- `bun run test:unit`
- `bun run test:integ`

When fixing bugs, add regression coverage where feasible.

## Maintaining This File

Keep `AGENTS.md` updated when:
- Adding a new package: add a brief description under the appropriate Stack Rules section
- Architecture boundaries change (server/webui/cli)
- Repo-wide conventions change (lint/type patterns, errors, OpenAPI generation)
- File paths referenced here move
