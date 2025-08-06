# Error-Handling Standardisation Plan

This document describes **what** we are building, **why** we are building it, **how** it fits the existing Dexto codebase, and **what steps** are required to complete the work.

The intended audience is an engineer who has **never** touched this repository before.  After reading, they should understand the terminology, the code snippets, and the exact migration path.

---

## 1  Current State (snapshot 2025-08-06)

| Element                                   | Current location                                       | Notes |
|-------------------------------------------|---------------------------------------------------------|-------|
| Flat error enum `DextoErrorCode`          | `src/core/schemas/errors.ts`                            | 36 codes (Agent 4, LLM 9, MCP 8, Validation 5, remaining misc) |
| Result helpers (`ok` / `fail` / `zodToIssues`) | `src/core/utils/result.ts`                              | Converts Zod → `Issue[]`, aggregates issues |
| Custom error classes                      | `src/core/agent/errors.ts`, `src/core/tools/errors.ts`  | DextoValidationError, DextoLLMError, DextoMCPError, DextoInputError, ToolExecutionDeniedError |
| API layer                                 | `src/app/api/**`                                        | Controllers manually call `res.status(400).json(err)`; no central middleware (~400+ lines repetitive) |

**Pain points**
* No concept of _domain_ or _category_; dashboards only see a flat code string.
* Boiler-plate: every throw site repeats the code and an ad-hoc message.
* Inconsistent JSON responses from the REST layer.
* "Validation" is overloaded to mean schema validation, input validation, and business rule validation.
* Many throw sites still use raw `Error` instead of typed errors.
* Result pattern is well-implemented but underutilized.

---

## 2  Design Goals

1. **Single canonical class** – every throwable object derives from `DextoError`.
2. **Three-axis metadata** – `code`, `scope`, `type` shipped with every error.
3. **Zero boiler-plate at call-sites** – via domain helper factories.
4. **Transport separation** – business logic only throws; HTTP/CLI layers decide how to serialise.
5. **Backwards compatibility** – existing code strings remain unchanged.
6. **Domain-owned validation** – validation errors belong to their functional domain, not a separate "validation" scope.
7. **Typed contexts** – preserve domain-specific context for better debugging.

---

## 3  Key Concepts & Public APIs

### 3.0 Issue Type Location

```ts
// src/core/error/issue.ts - Moved to avoid circular dependencies
export type Severity = 'error' | 'warning';
export interface Issue<C = unknown> {
  code: string;  // Will be typed as DextoErrorCode at usage sites
  message: string;
  path?: Array<string | number>;
  severity: Severity;
  context?: C;
}
```

### 3.1 Enums

```ts
// src/core/error/scopes.ts
export const enum ErrorScope {
  LLM     = 'llm',      // LLM operations, model compatibility, input validation for LLMs
  AGENT   = 'agent',    // Agent lifecycle, configuration, session management
  MCP     = 'mcp',      // MCP server connections and protocol
  TOOLS   = 'tools',    // Tool execution and authorization
  STORAGE = 'storage',  // Persistence layer operations (future consideration)
  // Note: No VALIDATION scope - validation errors belong to their domain
}

// src/core/error/types.ts
export const enum ErrorType {
  USER        = 'user',         // bad input, config errors, validation failures
  SYSTEM      = 'system',       // bugs, internal failures, unexpected states
  THIRD_PARTY = 'third_party',  // upstream provider failures, API errors
}
```

### 3.2 Per-domain error-code enums

```ts
// src/core/llm/error-codes.ts
export const enum LLMErrorCode {
  // Configuration errors
  MISSING_API_KEY           = 'llm_missing_api_key',
  UNSUPPORTED_ROUTER        = 'llm_unsupported_router',
  INCOMPATIBLE_PROVIDER     = 'llm_incompatible_model_provider',
  UNKNOWN_MODEL             = 'llm_unknown_model',
  MISSING_BASE_URL          = 'llm_missing_base_url',
  INVALID_BASE_URL          = 'llm_invalid_base_url',
  
  // Input validation errors (formerly generic "validation")
  INPUT_FILE_UNSUPPORTED    = 'llm_input_file_unsupported',
  INPUT_IMAGE_UNSUPPORTED   = 'llm_input_image_unsupported',
  MAX_INPUT_TOKENS_EXCEEDED = 'llm_max_input_tokens_exceeded',
  
  // Schema validation
  REQUEST_INVALID_SCHEMA    = 'llm_request_invalid_schema',
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
  | ToolErrorCode
  // No ValidationErrorCode - validation errors belong to domains
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
      recovery,
      traceId = crypto.randomUUID(),
    }: {
      severity?: 'error' | 'warning';
      details?: Record<string, unknown>;
      issues?: Issue<C>[];
      recovery?: string | string[];  // Actionable user suggestions
      traceId?: string;
    } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.severity = severity;
    this.details  = details;
    this.issues   = issues;
    this.recovery = recovery;
    this.traceId  = traceId;

    defaultLogger.trackException?.(this);   // optional auto-logging hook
  }

  public readonly severity: 'error' | 'warning';
  public readonly details?: Record<string, unknown>;
  public readonly issues: Issue<C>[];
  public readonly recovery?: string | string[];
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
      recovery: this.recovery,
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
export function ensureOk<T,C>(
  result: Result<T,C>,
  errorFactory: (issues: Issue<C>[]) => DextoError
): T {
  if (result.ok) return result.data;
  throw errorFactory(result.issues);
}

// Usage example:
const result = validateInputForLLM(input, config);
ensureOk(result, (issues) => 
  LLMError.inputValidationFailed(issues)
);
```

**Guideline**
* Internal validation / parsing functions → return `Result`.
* Public boundaries (DextoAgent, HTTP, CLI) → call `ensureOk` then either proceed or throw `DextoError`.

### 3.6  HTTP normaliser

```ts
// src/app/api/middleware/errorHandler.ts
import { ErrorType } from '@core/error/types.js';

// Explicit status overrides for specific error codes
const STATUS_OVERRIDES: Partial<Record<string, number>> = {
  'agent_session_not_found': 404,
  'tools_execution_denied': 403,
  'tools_execution_timeout': 408,
  'llm_rate_limit_exceeded': 429,
};

const statusFor = (err: DextoError): number => {
  // Check explicit overrides first
  const override = STATUS_OVERRIDES[err.code];
  if (override) return override;
  
  // Then by type
  switch (err.type) {
    case ErrorType.USER:        return 400;
    case ErrorType.THIRD_PARTY: return 502;
    case ErrorType.SYSTEM:      return 500;
    default:                    return 500;
  }
};

export function errorHandler(err, _req, res, _next) {
  if (err instanceof DextoError) {
    return res.status(statusFor(err)).json(err.toJSON());
  }
  
  // Log unexpected errors for debugging
  logger.error('Unhandled error:', err);
  res.status(500).json({ 
    code: 'internal_error', 
    message: 'Unexpected error',
    scope: 'system',
    type: 'system'
  });
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

### Existing Error Classes to Deprecate

Immediate deprecation list (20 classes total):
- **Storage**: `StorageError`, `StorageConnectionError`, `StorageNotFoundError`
- **Config**: `ConfigurationError` hierarchy (6 classes)
- **LLM**: `UnknownProviderError`, `UnknownModelError`, `CantInferProviderError`, `EffectiveMaxInputTokensError`, `TokenizationError`
- **Agent**: `DextoValidationError`, `DextoLLMError`, `DextoMCPError`, `DextoInputError`
- **Tools**: `ToolExecutionDeniedError`
- **Other**: `FileNotFoundError` (CLI-specific)

1. **Foundation**
   1. Create `src/core/error/issue.ts` with `Issue` and `Severity` types.
   2. Add `ErrorScope`, `ErrorType` enums.
   3. Implement `DextoError` base class with `recovery` field.
   4. Introduce `defaultLogger.trackException()` (noop implementation lives in `src/core/logger`).

2. **Code relocation**
   * For each domain (LLM, Agent, MCP, Tools)
     * Create `error-codes.ts` enum.
     * Migrate validation-related codes to their owning domain.
     * Remove corresponding members from the legacy flat enum (to be deleted at the end).
   * Add barrel file `src/core/error/codes.ts` exporting union `DextoErrorCode`.
   * Consider adding STORAGE scope for future persistence layer errors.

3. **Domain helper factories**
   * Implement `LLMError`, `AgentError`, `MCPError`, `ToolError` helpers.
   * Each factory preserves typed context specific to its domain.
   * Special handling for `ToolExecutionDeniedError` (403 status).
   * Delete obsolete ad-hoc classes (`DextoLLMError`, `DextoMCPError`, `DextoInputError`, etc.).

4. **Refactor throw sites**
   * Replace manual constructions with helper calls (`LLMError.missingApiKey()` etc.).
   * Update tests & imports.

5. **Result bridge**
   * Keep `Result<T,C>` pattern - it's excellent for validation aggregation
   * Add `ensureOk` helper with errorFactory parameter
   * Adopt it in validation-heavy modules (only 3 files use Result directly)
   * Update DextoAgent boundary methods to use `ensureOk` with domain factories

6. **API layer**
   * Add Express `errorHandler` (see 3.6) and register in `src/app/api/server.ts`.
   * Remove inline `res.status(…)` logic from controllers.

7. **Testing**
   * Unit: constructor fields, `toJSON`, status mapping.
   * Integration: failing REST call returns `{code,message,scope,type,severity,traceId}`.
   * Special cases: ToolExecutionDeniedError → 403, validation errors → 400.
   * Telemetry: verify `trackException` is called.

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
* When the *same* code might be USER or SYSTEM, expose **two** helpers with the appropriate type.
* Validation errors should live with their domain (e.g., `LLM_INPUT_FILE_UNSUPPORTED` not `VALIDATION_FILE_UNSUPPORTED`).
* The `recovery` field is now included in `DextoError` for actionable user suggestions.
* The `ensureOk` bridge requires an errorFactory function for proper domain-specific error creation.
* Tool confirmation errors should distinguish between user denial (403), timeout (408), and failure (500).
* Result<T,C> pattern should be preserved for validation functions that aggregate issues.
* Since we have 0 users, deprecate all old error classes immediately without migration shims.

---

_End of file_
