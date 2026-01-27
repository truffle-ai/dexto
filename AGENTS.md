# Dexto Development Guidelines for AI Assistants

This repo is reviewed by automated agents (including CodeRabbit). This file is the source of truth for repo-wide conventions and review expectations.

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
- Don’t communicate to the user via code comments. Comments are for future readers of the code, not for explaining decisions to the user.

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

## Avoiding Duplication (repo-wide)

Before adding a new helper/utility/service:
1. Search for existing utilities or similar patterns (glob/grep).
2. Prefer reuse or extension of existing helpers.
3. If introducing something new, explain why existing code cannot be reused.

This applies everywhere (core, server, cli, webui).

## Adding New Packages

All `@dexto/*` packages use **fixed versioning** (shared version number).

When creating a new package:
1. Add the package name to the `fixed` array in `.changeset/config.json`
2. Set its `version` in `package.json` to match other packages (check `packages/core/package.json`)

## Architecture & Design Patterns

### API / Server Layer

- Routes should be thin wrappers around core capabilities (primarily `DextoAgent` + core services).
- Keep business logic out of routes; keep route code focused on:
  - request parsing/validation
  - calling core
  - mapping errors + returning responses
- `DextoAgent` class should also not have too much business logic; should call helper methods within services it owns.

### Service Initialization

- **Config file is source of truth**: `agents/coding-agent/coding-agent.yml`
- **Override pattern for advanced use**: use `InitializeServicesOptions` only for top-level services (avoid wiring every internal dependency).
- **CLI Config Enrichment**: CLI adds per-agent paths (logs, database, blobs) via `enrichAgentConfig()` before agent initialization.
  - Source: `packages/agent-management/src/config/config-enrichment.ts`

### Execution Context Detection

Dexto infers its execution environment to enable context-aware defaults and path resolution.

- Key implementation: `packages/core/src/utils/execution-context.ts`
- Context-aware paths: `packages/core/src/utils/path.ts`
- Context-aware API key setup UX: `packages/cli/src/cli/utils/api-key-setup.ts`

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

- Avoid `throw new Error()` in core repo. Prefer typed errors.
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
2. Run `pnpm run sync-openapi-docs`
3. Verify the generated output includes your changes

## Logging

The repo contains logger v1 and logger v2 APIs (core). Prefer patterns compatible with structured logging.

- Prefer: `logger.info('Message', { contextKey: value })` (structured context as the second parameter where supported)
- Avoid: `logger.error('Failed:', err)` style extra-arg logging; it’s ambiguous across logger versions/transports.
- Template literals are fine when interpolating values:
  - `logger.info(\`Server running at \${url}\`)`

Colors:
- Color formatting exists (chalk-based), but treat color choice as optional and primarily CLI-facing (don’t encode “must use exact color X” rules in new code unless the existing subsystem already does).

Browser safety:
- `packages/core/src/logger/logger.ts` is Node-oriented (fs/path/winston). Be careful not to import Node-only runtime modules into `packages/webui` bundles. Prefer `import type` when consuming core types from the WebUI.

## TypeScript Guidelines

- Strict null safety: handle `null` / `undefined` explicitly.
- Avoid `any` across the repo.
  - Prefer `unknown` + type guards.
  - If `any` is unavoidable (third-party typing gaps / boundary code), keep the usage local and justify it.
- In tests, prefer `@ts-expect-error` over `as any` when intentionally testing invalid inputs.
- Avoid introducing optional parameters unless necessary; prefer explicit overloads or separate functions if it improves call-site clarity.

## Module Organization

- Selective barrel strategy: only add `index.ts` at real public module boundaries.
- Prefer direct imports internally; avoid deep re-export chains.
- Avoid wildcard exports; prefer explicit named exports.
- Watch for mega barrels (>20 symbols or >10 files) and split if needed.

## Git / PR Standards

- Never use `git add .` or `git add -A`. Stage explicit files/paths only.
- Always inspect staged files before committing.
- Don’t include AI-generated footers in commits/PRs.
- Keep commit messages technical and descriptive.

## Documentation Changes

- Always request user review before committing documentation changes.
- Never auto-commit documentation updates.
- Keep documentation user-focused; avoid exposing unnecessary internal complexity.

## Testing

Test types:
- Unit: `*.test.ts`
- Integration: `*.integration.test.ts`

Common commands:
- `pnpm test`
- `pnpm run test:unit`
- `pnpm run test:integ`

When fixing bugs, add regression coverage where feasible.

## Maintaining This File

Keep `AGENTS.md` updated when:
- Architecture boundaries change (server/webui/cli)
- Repo-wide conventions change (lint/type patterns, errors, OpenAPI generation)
- File paths referenced here move
