# Human-in-the-Loop / Tool Confirmation: Handler-First Redesign

**Status:** Draft
**Owner:** @me
**Scope:** Core (`@dexto/core`) + Server (`@dexto/server`)
**Breaking changes:** Yes (mode rename + runtime invariant)

---

## 1. Motivation

Today, tool confirmation / human-in-the-loop (HIL):

- Is **configured** via `toolConfirmation` in `AgentConfig` (mode, timeout, policies).
- Is **enforced** in `ToolManager.handleToolApproval`, which:
  - Honors `alwaysDeny` → `alwaysAllow` → per-session allowed cache → mode.
  - Calls `ApprovalManager.requestToolConfirmation(...)` when confirmation is needed.
- Is **implemented** via:
  - `ApprovalManager` emitting `dexto:approvalRequest` on `AgentEventBus`.
  - `WebSocketEventSubscriber` broadcasting that to the web UI.
  - Web UI sending `approvalResponse` over WS, which the server turns into `dexto:approvalResponse`.

Problems:

1. If you enable event-based HIL and don't have the WS/UI running, `agent.run()` can hang forever.
2. WebSockets are a de-facto requirement for HIL.
3. There is no explicit runtime API for plugging a custom approval flow (CLI, REST-only, custom UI).

We want a design where:

- Config continues to define **policies** and **mode**.
- Runtime defines **how** approvals are obtained.
- WebSocket is just one implementation detail, not the core abstraction.

---

## 2. Goals & Non-Goals

### Goals

- Make HIL **safe** for library users (no silent hangs).
- Make HIL **transport-agnostic**:
  - WS is one implementation.
  - REST/SSE/webhooks/CLI are possible.
- Keep `toolConfirmation` **config-only** (Zod schemas unchanged in spirit).
- Keep enforcement logic in `ToolManager` intact (precedence rules unchanged).

### Non-Goals

- No redesign of HIL semantics (same approval precedence, same policies).
- No new UI in this plan (just backend/core changes).
- No attempt to make HIL pluggable from config (handlers remain code-only).

---

## 3. High-Level Design

### Single invariant

> If `toolConfirmation.mode === 'manual'`, an approval handler **must** be provided at runtime.
> No handler ⇒ startup error. WS or non-WS doesn't matter.

We move to a **handler-first** design:

- Config defines **when** we need human approval (`manual` vs `auto-approve` vs `auto-deny`).
- Runtime defines **how** we get that approval (a single `ApprovalHandler` function).
- `ApprovalManager` delegates to that handler; it no longer assumes WS.

---

## 4. Config Changes

### 4.1 Rename `event-based` → `manual`

Breaking change in `ToolConfirmationConfigSchema`.

**Current location:** `packages/core/src/tools/schemas.ts:4`

```ts
// Before
const TOOL_CONFIRMATION_MODES = ['event-based', 'auto-approve', 'auto-deny'] as const;

// After
const TOOL_CONFIRMATION_MODES = ['manual', 'auto-approve', 'auto-deny'] as const;
export type ToolConfirmationMode = (typeof TOOL_CONFIRMATION_MODES)[number];
```

* `manual` more clearly describes user-driven approval.
* No backwards compatibility needed (breaking change acceptable).

### 4.2 Keep policies & timeouts as-is

No changes to:

* `timeout`
* `allowedToolsStorage`
* `toolPolicies` (`alwaysAllow`, `alwaysDeny`)
* `internalTools`

They remain pure Zod config and are still read by `ToolManager` and `AllowedToolsProvider`.

---

## 5. Runtime API Changes

### 5.1 Approval types & handler

New runtime-only types (not part of any Zod schema):

```ts
// approval/types.ts
export interface ApprovalRequestPayload {
  approvalId: string;
  sessionId?: string;
  type: 'tool_confirmation' | 'elicitation' | 'custom';
  toolName?: string;
  args?: Record<string, unknown>;
  // any other fields we currently send over WS to the UI
}

export interface ApprovalResponsePayload {
  approvalId: string;
  sessionId?: string;
  status: 'approved' | 'denied' | 'cancelled';
  data?: {
    rememberChoice?: boolean;
    // room for future metadata
  };
}

export type ApprovalHandler = (
  request: ApprovalRequestPayload
) => Promise<ApprovalResponsePayload>;
```

### 5.2 ApprovalManager: handler-first

`ApprovalManager` becomes responsible for calling the handler:

```ts
// approval/manager.ts
class ApprovalManager {
  private handler?: ApprovalHandler;

  constructor(
    private readonly config: ApprovalManagerConfig,
    agentEventBus?: AgentEventBus // Optional, only for backward compat
  ) {
    // Validate handler requirement at construction time
    if (config.mode === 'manual' && !this.handler) {
      throw new Error(
        'Tool confirmation mode is "manual" but no approval handler is configured.\n' +
        'Either:\n' +
        '  • set mode to "auto-approve" or "auto-deny", or\n' +
        '  • call agent.setApprovalHandler(...) before start().'
      );
    }
  }

  setHandler(handler: ApprovalHandler | null): void {
    this.handler = handler ?? undefined;
  }

  hasHandler(): boolean {
    return !!this.handler;
  }

  private ensureHandler(): ApprovalHandler {
    if (!this.handler) {
      throw new Error(
        'Tool confirmation mode is "manual" but no approval handler is configured.'
      );
    }
    return this.handler;
  }

  async requestToolConfirmation(input: {
    toolName: string;
    args: Record<string, unknown>;
    sessionId?: string;
  }): Promise<ApprovalResponsePayload> {
    const handler = this.ensureHandler();

    const approvalRequest: ApprovalRequestPayload = {
      approvalId: this.generateApprovalId(),
      type: 'tool_confirmation',
      toolName: input.toolName,
      args: input.args,
      sessionId: input.sessionId,
    };

    return handler(approvalRequest);
  }

  // getPendingApprovals, cancelApproval, cancelAllApprovals
  // remain as-is (can be optional helpers used by handlers)
}
```

Notes:

* `ToolManager` does not change; it still calls `approvalManager.requestToolConfirmation(...)`.
* `ApprovalManager` no longer bakes in any transport assumptions.
* Validation happens at construction time for fail-fast behavior.

### 5.3 DextoAgent: handler registration

Expose a clean API on `DextoAgent`:

```ts
// agent/DextoAgent.ts
class DextoAgent {
  // services created via createAgentServices(...)
  private services!: AgentServices;

  setApprovalHandler(handler: ApprovalHandler): void {
    this.services.approvalManager.setHandler(handler);
  }

  clearApprovalHandler(): void {
    this.services.approvalManager.setHandler(null);
  }
}
```

This is the **only** runtime API for HIL wiring:

* Server/CLI will use it to plug in WebSocket-based approval.
* Library users will use it to plug in CLI prompts / their own UI / whatever.

---

## 6. Invariants & Validation

### 6.1 Enforce handler requirement at construction

**Validation happens in `ApprovalManager` constructor** (not at agent startup):

```ts
// approval/manager.ts
constructor(
  private readonly config: ApprovalManagerConfig,
  agentEventBus?: AgentEventBus
) {
  // Fail fast if manual mode without handler
  if (config.mode === 'manual' && !this.handler) {
    throw new Error(
      'Tool confirmation mode is "manual" but no approval handler is configured.\n' +
      'Either:\n' +
      '  • set mode to "auto-approve" or "auto-deny", or\n' +
      '  • call agent.setApprovalHandler(...) before start().'
    );
  }
}
```

**Benefits:**
- Fail-fast: Error at construction, not during first tool call
- Single responsibility: Validation lives where it's enforced
- Clear error location: ApprovalManager constructor

This removes the possibility of "manual mode with no handler" silently hanging.

### 6.2 Behavior summary per mode

* `auto-approve`
  * No handler required.
  * `ToolManager` never calls `ApprovalManager` (skips confirmation).
* `auto-deny`
  * No handler required.
  * `ToolManager` throws immediately for tools that reach the confirmation layer.
* `manual`
  * **Handler required**.
  * `ToolManager` calls `ApprovalManager`, which calls the handler.

---

## 7. WebSocket Integration in the New Model

### 7.1 WS handler as a thin wrapper

**Note:** This approach will be revisited during implementation. The current `EventBasedApprovalProvider` already implements much of this logic, and we may be able to reuse it directly instead of creating a wrapper.

In the server package, we implement the handler on top of the existing event bus + WS:

```ts
function createWebSocketApprovalHandler(
  eventBus: AgentEventBus,
  wsManager: WebSocketManager, // small helper that tracks open sockets, etc.
  timeoutMs: number
): ApprovalHandler {
  const pending = new Map<string, {
    resolve: (res: ApprovalResponsePayload) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }>();

  // When approvalResponse events come back from WS → server → bus:
  eventBus.on('dexto:approvalResponse', (res: ApprovalResponsePayload) => {
    const entry = pending.get(res.approvalId);
    if (!entry) return;

    pending.delete(res.approvalId);
    clearTimeout(entry.timer);
    entry.resolve(res);
  });

  return (req: ApprovalRequestPayload) => {
    return new Promise<ApprovalResponsePayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(req.approvalId);
        reject(new Error('Approval request timed out'));
      }, timeoutMs);

      pending.set(req.approvalId, { resolve, reject, timer });

      // Broadcast the request as we do today via event bus + WebSocketEventSubscriber
      eventBus.emit('dexto:approvalRequest', req);
    });
  };
}
```

Then, in server/bootstrap code:

```ts
const timeoutMs = agent.config.toolConfirmation?.timeout ?? 120_000;
const approvalHandler = createWebSocketApprovalHandler(
  agent.agentEventBus,
  wsManager,
  timeoutMs
);

agent.setApprovalHandler(approvalHandler);
```

### 7.2 WS server remains largely unchanged

* `WebSocketEventSubscriber` still listens to `dexto:approvalRequest` and broadcasts `event: 'approvalRequest'` to clients.
* The WS server still:
  * receives `approvalResponse` messages from the web UI,
  * validates them,
  * emits them on the `AgentEventBus` as `dexto:approvalResponse`.

We've just pulled the "wait for response and resolve a promise" logic into the handler, instead of hiding it inside `ApprovalManager` or random WS code.

---

## 8. Usage Examples

### 8.1 Library usage (no WebSocket)

```ts
import { DextoAgent } from '@dexto/core';

const agent = new DextoAgent({
  // ...config from YAML or inline
  toolConfirmation: {
    mode: 'manual',
    timeout: 60000,
    // policies...
  },
});

agent.setApprovalHandler(async (req) => {
  // e.g., log and auto-approve for now
  console.log('Tool requested:', req.toolName, req.args);
  return {
    approvalId: req.approvalId,
    status: 'approved',
    sessionId: req.sessionId,
  };
});

await agent.start();
const result = await agent.run('Call a dangerous tool');
```

### 8.2 Server usage with WebSocket UI

```ts
const agent = new DextoAgent(config);
await agent.start();

const wsManager = new WebSocketManager(/* ... */);
const timeoutMs = agent.config.toolConfirmation?.timeout ?? 120_000;

agent.setApprovalHandler(
  createWebSocketApprovalHandler(agent.agentEventBus, wsManager, timeoutMs)
);

// existing WS <-> eventBus wiring stays in place
startWebSocketServer(wsManager, agent);
```

---

## 9. Rollout Plan

### Phase 1 – Core changes

* Implement:
  * `ApprovalRequestPayload`, `ApprovalResponsePayload`, `ApprovalHandler`.
  * `ApprovalManager.setHandler`, `hasHandler`, and handler-first `requestToolConfirmation`.
* Add `DextoAgent.setApprovalHandler` and `clearApprovalHandler`.
* Enforce the "manual requires handler" invariant at startup.

### Phase 2 – Server/WebSocket integration

* Implement `createWebSocketApprovalHandler`.
* Wire `agent.setApprovalHandler(...)` in server bootstrap code.
* Keep the existing WS message shapes and event bus events.

### Phase 3 – Mode rename

* Change `ToolConfirmationMode` from `event-based` to `manual`.
* Update:
  * schemas,
  * `ToolManager` constructors,
  * any hard-coded string checks.
* Update docs and examples to use `manual`.

### Phase 4 – Docs and examples

* Update README / guides:
  * Explain the three modes (manual, auto-approve, auto-deny).
  * Show library usage with `setApprovalHandler`.
  * Show server usage with WS handler.

---

## 10. Open Questions

* Should we expose a higher-level `agent.cancelApproval(approvalId)` API that forwards to `ApprovalManager`?
* Do we need separate approval handlers per `type` (`tool_confirmation` vs `elicitation`) or is a single handler enough for now?
* Do we want a default "logging-only manual handler" for dev mode, or require explicit `setApprovalHandler` even in dev?

These can be resolved after the first implementation lands; the core handler-first structure will support all of them.

---

## 11. Implementation Notes

### Code Review Findings

**Current Architecture Analysis** (based on `/Users/karaj/Projects/dexto-ui-refactors/packages/core/src/approval/`):

1. **Existing Provider Pattern:**
   - Current code already has `ApprovalProvider` interface with multiple implementations
   - `EventBasedApprovalProvider` handles WS-based approvals
   - `NoOpApprovalProvider` handles auto-approve/auto-deny modes
   - Factory pattern in `ApprovalManager.createProvider()`

2. **Handler vs Provider Trade-off:**
   - **Handler approach (chosen)**: Single function `(req) => Promise<res>`
     - ✅ Simpler API surface
     - ✅ Aligns with "handler-first" philosophy
     - ✅ Less coupling to internal state management
     - ⚠️ Loses built-in cancellation APIs (must be rebuilt if needed)
   - **Provider approach (alternative)**: Full interface with lifecycle methods
     - ✅ Keeps existing cancellation APIs
     - ✅ Less code churn
     - ⚠️ More complex interface for simple use cases

   **Decision:** Proceed with handler approach. Breaking changes are acceptable. Cancellation can be reimplemented if needed.

3. **Schema Location:**
   - Current: `packages/core/src/tools/schemas.ts` (line 4)
   - Contains `TOOL_CONFIRMATION_MODES` and `ToolConfirmationConfigSchema`
   - Consider moving to `approval/schemas.ts` for better module organization (optional cleanup)

4. **WebSocket Integration (Revisit Point):**
   - Current `EventBasedApprovalProvider` already implements:
     - Promise-based pending request tracking (Map)
     - Event bus listener for `dexto:approvalResponse`
     - Timeout handling
     - Event emission for `dexto:approvalRequest`
   - **Implementation decision needed:** Wrap existing provider vs. rewrite as thin handler
   - Options:
     - A) Create new `createWebSocketApprovalHandler()` wrapper (as in plan)
     - B) Adapt `EventBasedApprovalProvider` to expose handler function
     - C) Keep provider pattern for WS, use handlers elsewhere
   - **Defer until implementation** to evaluate code reuse vs. conceptual clarity

### Files to Modify

**Core package:**
- `packages/core/src/approval/manager.ts` - Add handler registration and validation
- `packages/core/src/approval/types.ts` - Add `ApprovalHandler` type
- `packages/core/src/agent/DextoAgent.ts` - Add `setApprovalHandler()` API
- `packages/core/src/tools/schemas.ts` - Rename mode to `manual`

**Server package:**
- `packages/server/src/hono/node/index.ts` - Wire approval handler for WS
- Create `packages/server/src/approval/websocket-handler.ts` (or adapt existing provider)

### Testing Strategy

1. **Unit tests:**
   - `ApprovalManager` with/without handler
   - Constructor validation for `manual` mode
   - Handler invocation and response handling

2. **Integration tests:**
   - Library usage with custom handler
   - Server usage with WS handler
   - Mode switching (manual, auto-approve, auto-deny)

3. **Migration validation:**
   - Ensure all `event-based` references updated to `manual`
   - Verify no silent hangs in manual mode without handler
