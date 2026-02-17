# Tool Type Safety Plan

This note captures the follow-up work to make Dexto tool implementations fully type-safe by inferring tool input types from `inputSchema`.

Status: **ready** (design approved; proceed with implementation).

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

### 1) Make `Tool` generic and schema-driven (including preview/approval hooks)

Change `Tool` in `packages/core/src/tools/types.ts` to be generic over a Zod schema and use `z.output<TSchema>` across all hooks that consume tool args.

Important TypeScript ergonomics note:
- Prefer **method signatures** (not function properties) for `execute` / `generatePreview` / approval hooks.
- This keeps `Tool<TSchema>` assignable in heterogeneous collections without fighting variance rules.

- `Tool<TSchema extends ZodTypeAny = ZodTypeAny>`
- `inputSchema: TSchema`
- `execute(input: z.output<TSchema>, context: ToolExecutionContext): …`
- `generatePreview?(input: z.output<TSchema>, context: ToolExecutionContext): …`
- `getApprovalOverride?(input: z.output<TSchema>, context: ToolExecutionContext): …`
- `getApprovalPatternKey?(input: z.output<TSchema>): …`
- `suggestApprovalPatterns?(input: z.output<TSchema>): …`

This ensures:
- `execute` is typed automatically based on schema defaults/coercions.

### 2) Provide a helper for inference (recommended)

Add `defineTool(...)` (or `tool(...)`) in `@dexto/core/tools`:

- identity function
- improves inference at callsites and keeps tool construction consistent

### 3) Keep runtime parsing in `ToolManager`

`ToolManager` should continue to:
- `safeParse` tool args exactly once **before** preview/approval/custom-approval overrides/pattern helpers
- pass the validated output into:
  - preview generation
  - pattern key/suggestions
  - custom approval override flow
  - execution

However, `beforeToolCall` hooks may modify `args` after approval and before execution. To preserve current semantics:
- re-validate args after `beforeToolCall` (before calling the tool’s `execute`)
- add a short comment at the re-validation site explaining why this is necessary (hook mutation means a single validation pass cannot cover the entire pipeline)

---

## Approval/preview behavior

Right now, `generatePreview`, `getApprovalOverride`, and approval pattern helpers operate on untyped args.

This plan makes tool args validated **before** preview/approval so these hooks can be fully typed and “invalid tool args” fail fast (before any approval UI).

---

## Migration plan

### Phase 1 — Core typing + helper
- Introduce generic `Tool<TSchema>` typing in core.
- Add `defineTool(...)` helper (preferred authoring primitive).

### Phase 2 — ToolManager: validate before approval/preview; re-validate before execute
- Validate local tool args once at the start of tool execution (before preview/approval/custom approvals/patterns).
- Use validated args across the approval/preview pipeline.
- Re-validate only if/when `beforeToolCall` hooks mutate `args` (preserve semantics; avoid subtle behavior changes).

### Phase 3 — Update all tool implementations
- Convert each tool implementation to:
  - define `const InputSchema = z.object(...).strict()`
  - `return defineTool({ … })`
  - `execute(input, context) { … }` (no `unknown`, no casts)
  - typed `generatePreview(input, …)` / `getApprovalOverride(input, …)` (no `unknown`, no casts)
- Update tests as needed (mostly removing casts).

---

## Acceptance criteria

- No `input as …` casts remain in tool implementations (except rare boundary cases).
- `execute`, `generatePreview`, `getApprovalOverride`, and pattern helpers are typed end-to-end from Zod schema output.
- Repo builds/tests/typecheck pass.
