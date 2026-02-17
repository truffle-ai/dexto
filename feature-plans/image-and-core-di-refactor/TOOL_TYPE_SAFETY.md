# Tool Type Safety Plan

This note captures the follow-up work to make Dexto tool implementations fully type-safe by inferring tool input types from `inputSchema`.

Status: **planned** (skip implementation for now; do in a follow-up PR).

---

## Problem

Today, `Tool.execute()` receives `input: unknown` even though each tool provides a Zod `inputSchema`:

- Runtime validation is enforced by `ToolManager` (`safeParse` before execution).
- Tool implementations still cast (`input as …`) which is:
  - noisy
  - easy to get subtly wrong
  - inconsistent across tools

Additionally, several other tool hooks (`generatePreview`, approval helpers) currently receive untyped args, which pushes more casts into tool code.

Current relevant code:
- Dexto tool surface: `packages/core/src/tools/types.ts`
- Central parsing + dispatch: `packages/core/src/tools/tool-manager.ts`

---

## Goals

1. Eliminate `input as …` in tool implementations.
2. Infer tool input types directly from `inputSchema`.
3. Keep runtime validation centralized (do not duplicate parsing logic inside every tool).
4. Apply consistently across all tool packages:
   - `@dexto/tools-builtins`
   - `@dexto/tools-filesystem`
   - `@dexto/tools-process`
   - `@dexto/tools-todo`
   - `@dexto/tools-plan`
   - `@dexto/tools-lifecycle`
   - any image-provided/custom tool surfaces that implement the same interface

Non-goals:
- No backward compatibility (repo policy for this refactor line).
- No tool surface redesign (that’s handled separately in `TOOL-SURFACE-REFACTOR.md`).

---

## Reference patterns

### Vercel AI SDK

AI SDK tools are generic over input/output and infer `execute` args from a schema via an identity helper (`tool(...)` / `dynamicTool(...)`).

Key files:
- Tool types + helpers: `/Users/karaj/Projects/external/ai/packages/provider-utils/src/types/tool.ts`
  - `export type Tool<INPUT, OUTPUT> = { inputSchema: FlexibleSchema<INPUT>; execute: ToolExecuteFunction<INPUT, OUTPUT>; … }`
  - `export function tool(...)` is a typed identity helper (overloads) to preserve inference at the callsite.
  - `export type InferToolInput/InferToolOutput` are convenience helpers for extracting types.
- Example usage: `/Users/karaj/Projects/external/ai/packages/devtools/examples/basic/tools.ts`
  - `tool({ inputSchema: z.object({ location: z.string() }), execute: async ({ location }) => … })`
    → `{ location }` is strongly typed from `inputSchema`.

### OpenCode

OpenCode defines tools with a Zod schema (`parameters`) and types `execute(args)` from that schema, with a helper that wraps runtime parsing once.

Key file:
- Tool definition helper + types: `/Users/karaj/Projects/external/opencode/packages/opencode/src/tool/tool.ts`
  - `Tool.Info<Parameters extends z.ZodType>` returns:
    - `parameters: Parameters`
    - `execute(args: z.infer<Parameters>, ctx: Tool.Context): …`
  - `Tool.define(...)` wraps `execute` with `toolInfo.parameters.parse(args)` so tools don’t repeat parsing logic.

---

## Proposed API (core)

### 1) Make `Tool` generic and schema-driven

Change `Tool` in `packages/core/src/tools/types.ts` to be generic over a Zod schema:

- `Tool<TSchema extends ZodTypeAny = ZodTypeAny>`
- `inputSchema: TSchema`
- `execute(input: z.output<TSchema>, context: ToolExecutionContext): …`
- `generatePreview?(input: z.output<TSchema>, context: ToolExecutionContext): …`

This ensures:
- `execute` is typed automatically based on schema defaults/coercions.

### 2) Provide a helper for inference (optional but recommended)

Add `defineTool(...)` (or `tool(...)`) in `@dexto/core/tools`:

- identity function
- improves inference at callsites and keeps tool construction consistent

### 3) Keep runtime parsing in `ToolManager`

`ToolManager` should continue to:
- `safeParse` tool args exactly once
- pass the validated output into `execute` (and optionally into preview/approval helpers if we refactor that phase)

---

## Approval/preview follow-up (recommended)

Right now, `generatePreview`, `getApprovalOverride`, and approval pattern helpers operate on untyped args.

Recommended follow-up (separate commit):
- Validate tool args once **before** preview/approval.
- Use the validated output for:
  - preview generation
  - pattern key/suggestions
  - approval overrides

Benefit:
- eliminates more casts
- makes “invalid tool args” fail fast before approval UI

---

## Migration plan

### Phase 1 — Core typing + helper
- Introduce generic `Tool<TSchema>` typing in core.
- Update `ToolManager` typing to pass validated args into `execute` without casts.
- Add `defineTool(...)` helper (optional, but preferred).

### Phase 2 — Update all tool implementations
- Convert each tool implementation to:
  - define `const InputSchema = z.object(...).strict()`
  - `execute: async (input, context) => { … }` (no `unknown`, no casts)
- Update tests as needed (mostly removing casts).

### Phase 3 — Validate earlier for preview/approval (optional)
- Refactor `ToolManager` approval pipeline to parse args before preview/approval helpers.
- Ensure errors are surfaced as `ToolError.validationFailed(...)` where appropriate.

---

## Acceptance criteria

- No `input as …` casts remain in tool implementations (except rare boundary cases).
- `execute` args are typed end-to-end from Zod schema.
- Repo builds/tests/typecheck pass.
