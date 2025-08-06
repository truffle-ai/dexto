# Error-Handling Standardisation Plan

This document describes **what** we are building, **why** we are building it, **how** it fits the existing Dexto codebase, and **what steps** are required to complete the work.

The intended audience is an engineer who has **never** touched this repository before.  After reading, they should understand the terminology, the code snippets, and the exact migration path.

---

## 1  Current State (snapshot 2025-08-06)

| Element                                   | Current location                                       | Notes |
|-------------------------------------------|---------------------------------------------------------|-------|
| Flat error enum `DextoErrorCode`          | `src/core/schemas/errors.ts`                            | 33 codes (Agent 4, LLM 9, MCP 8, Validation 12) |
| Result helpers (`ok` / `fail` / `zodToIssues`) | `src/core/utils/result.ts`                              | Converts Zod → `Issue[]`, aggregates issues |
| Custom error classes                      | `src/core/agent/errors.ts`, `src/core/tools/…`, etc.    | Only a handful, many throw sites still use raw `Error` |
| API layer                                 | `src/app/api/**`                                        | Controllers manually call `res.status(400).json(err)`; no central middleware |

**Pain points**
* No concept of _domain_ or _category_; dashboards only see a flat code string.
* Boiler-plate: every throw site repeats the code and an ad-hoc message.
* Inconsistent JSON responses from the REST layer.

---

## 2  Design Goals

1. **Single canonical class** – every throwable object derives from `DextoError`.
2. **Three-axis metadata** – `code`, `domain`, `category` shipped with every error.
3. **Zero boiler-plate at call-sites** – via domain helper factories.
4. **Transport separation** – business logic only throws; HTTP/CLI layers decide how to serialise.
5. **Backwards compatibility** – existing code strings remain unchanged.

---

## 3  Key Concepts & Public APIs

### 3.1 Enums

```ts
// src/core/error/domains.ts
export const enum ErrorScope {
  LLM   = 'llm',
  AGENT = 'agent',
  MCP   = 'mcp',
  TOOLS = 'tools',
  VALIDATION = 'validation',
}

// src/core/error/types.ts
export const enum ErrorType {
  USER        = 'user',         // bad input / config
  SYSTEM      = 'system',       // bug or internal failure
  THIRD_PARTY = 'third_party',  // upstream provider failure
}
```

### 3.2 Per-domain error-code enums

```ts
// src/core/llm/error-codes.ts
export const enum LLMErrorCode {
  MISSING_API_KEY           = 'llm_missing_api_key',
  UNSUPPORTED_ROUTER        = 'llm_unsupported_router',
  INCOMPATIBLE_PROVIDER     = 'llm_incompatible_model_provider',
  MAX_INPUT_TOKENS_EXCEEDED = 'llm_max_input_tokens_exceeded',
  UNKNOWN_MODEL             = 'llm_unknown_model',
}
```

A barrel file unites all domain enums so external code still imports **one** name:

```ts
// src/core/error/codes.ts
export { LLMErrorCode }   from '@core/llm/error-codes.js';
export { AgentErrorCode } from '@core/agent/error-codes.js';
// …additional exports

export type DextoErrorCode =
  | LLMErrorCode
  | AgentErrorCode
  | MCPErrorCode
  | ValidationErrorCode;
```

### 3.3 `DextoError` base class (flattened constructor)

```ts
// src/core/error/DextoError.ts
import { ErrorScope }   from './domains.js';
import { ErrorType } from './types.js';

export class DextoError<C = unknown> extends Error {
  constructor(
    public readonly code: DextoErrorCode,
    public readonly scope: ErrorScope,
    public readonly type: ErrorType,
    message: string,
    {
      severity = 'error',
      details,
      issues = [],
      traceId = crypto.randomUUID(),
    }: {
      severity?: 'error' | 'warning';
      details?: Record<string, unknown>;
      issues?: Issue<C>[];
      traceId?: string;
    } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.severity = severity;
    this.details  = details;
    this.issues   = issues;
    this.traceId  = traceId;

    defaultLogger.trackException?.(this);   // optional auto-logging hook
  }

  public readonly severity: 'error' | 'warning';
  public readonly details?: Record<string, unknown>;
  public readonly issues: Issue<C>[];
  public readonly traceId: string;

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      scope: this.scope,
      type: this.type,
      severity: this.severity,
      details: this.details,
      issues: this.issues,
      traceId: this.traceId,
    };
  }
}
```

### 3.4  Domain helper factories

```ts
// src/core/llm/errors.ts
export class LLMError {
  static missingApiKey(msg = 'API key required') {
    return new DextoError(
      LLMErrorCode.MISSING_API_KEY,
      ErrorScope.LLM,
      ErrorType.USER,
      msg,
    );
  }

  static incompatibleProvider(provider: string) {
    return new DextoError(
      LLMErrorCode.INCOMPATIBLE_PROVIDER,
      ErrorScope.LLM,
      ErrorType.USER,
      `Provider '${provider}' is not supported`,
    );
  }
  // …other helpers
}
```

Call-site usage:

```ts
if (!apiKey) throw LLMError.missingApiKey();
```

`instanceof DextoError` still works for broad catches; fine-grained checks continue to use `err.code`.

### 3.5  `Result<T,C>` bridge

```ts
// src/core/utils/result-bridge.ts
export function ensureOk<T,C>(r: Result<T,C>): T {
  if (r.ok) return r.data;
  throw new DextoError(
    ValidationErrorCode.AGGREGATE_VALIDATION,
    ErrorScope.VALIDATION,
    ErrorType.USER,
    'Validation failed',
    { issues: r.issues },
  );
}
```

**Guideline**
* Internal validation / parsing functions → return `Result`.
* Public boundaries (DextoAgent, HTTP, CLI) → call `ensureOk` then either proceed or throw `DextoError`.

### 3.6  HTTP normaliser

```ts
// src/app/api/middleware/errorHandler.ts
import { ErrorType } from '@core/error/types.js';

const statusFor = (cat: ErrorType): number =>
  cat === ErrorType.USER         ? 400 :
  cat === ErrorType.THIRD_PARTY  ? 502 : 500;

export function errorHandler(err, _req, res, _next) {
  if (err instanceof DextoError) {
    return res.status(statusFor(err.category)).json(err.toJSON());
  }
  res.status(500).json({ code: 'internal_error', message: 'Unexpected error' });
}
```

Mounted once in `src/app/api/server.ts` → *all* controller code just `throw`s.

---

## 4  When to **Return** `Result` vs **Throw** `DextoError`

| Layer / Function type                          | Pattern | Rationale |
|------------------------------------------------|---------|-----------|
| Deep validation helper (Zod schemas, path parsers) | `Result<T,C>` | Allows aggregation of multiple issues in one pass |
| Module boundary (LLM registry, Agent method)   | `ensureOk` & throw on failure | Caller can `try/catch` or let API middleware handle |
| Public API route                               | Just `throw`; middleware serialises | Consistent JSON envelope, no boiler-plate |
| CLI command handler                            | `try { … } catch(e) { print(normalise(e)) }` | Human-readable formatting |

---

## 5  Task Breakdown (no timelines)

1. **Foundation**
   1. Add `ErrorScope`, `ErrorType` enums.
   2. Implement `DextoError` base class.
   3. Introduce `defaultLogger.trackException()` (noop implementation lives in `src/core/logger`).

2. **Code relocation**
   * For each domain (LLM, Agent, MCP, Validation, Tools)
     * Create `error-codes.ts` enum.
     * Remove corresponding members from the legacy flat enum (to be deleted at the end).
   * Add barrel file `src/core/error/codes.ts` exporting union `DextoErrorCode`.

3. **Domain helper factories**
   * Implement `LLMError`, `AgentError`, `MCPError`, `ValidationError`, `ToolError` helpers.
   * Delete obsolete ad-hoc classes (`DextoLLMError`, etc.).

4. **Refactor throw sites**
   * Replace manual constructions with helper calls (`LLMError.missingApiKey()` etc.).
   * Update tests & imports.

5. **Result bridge**
   * Add `ensureOk` helper; adopt it in validation-heavy modules.

6. **API layer**
   * Add Express `errorHandler` (see 3.6) and register in `src/app/api/server.ts`.
   * Remove inline `res.status(…)` logic from controllers.

7. **Testing**
   * Unit: constructor fields, `toJSON`, status mapping.
   * Integration: failing REST call returns `{code,message,domain,category}`.

8. **Documentation**
   * Move/rename this file to `docs/architecture/errors.md` once implementation lands.
   * Document JSON envelope fields and example responses.

9. **Cleanup**
   * Delete `src/core/schemas/errors.ts` after all references are gone.
   * Ensure `npm run build && npm run lint && npm run test && npm run typecheck` all succeed.

---

## 6  Gotchas & Conventions

* **No stack traces in API JSON** – rely on server logs for details.
* Factory helpers must never perform side effects; they _only_ create an instance.
* Adding a new error:
  1. Extend the correct domain enum.
  2. Add factory helper.
  3. Write or update tests.
* When the *same* code might be USER or SYSTEM, expose **two** helpers with the appropriate category.

---

_End of file_
