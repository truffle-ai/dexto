---
sidebar_position: 10
---

# Hooks Configuration

Extend agent behavior with custom logic that runs at specific points in the request/response lifecycle.

:::tip Complete Reference
For complete field documentation, hook interfaces, and implementation details, see **[agent.yml → Hooks](./agent-yml.md#hooks)**.
:::

## Overview

Dexto's hook system allows you to inject custom logic at four key lifecycle points: before LLM requests, before tool calls, after tool results, and before responses.

**Hook points:**

- **beforeLLMRequest** - Validate/modify input before LLM
- **beforeToolCall** - Check tool arguments before execution
- **afterToolResult** - Process tool results
- **beforeResponse** - Sanitize/format final response

**Common uses:**

- Security & compliance (content filtering, PII redaction)
- Observability (logging, metrics, analytics)
- Data transformation (preprocessing, formatting, translation)
- Business logic (validation, workflow enforcement, cost tracking)

## Hook Types

### Built-in Hooks

**contentPolicy** - Enforce content policies on input:

```yaml
hooks:
  - type: content-policy
    enabled: true
    maxInputChars: 50000
    redactEmails: true
    redactApiKeys: true
```

**responseSanitizer** - Clean responses before sending:

```yaml
hooks:
  - type: response-sanitizer
    enabled: true
    redactEmails: true
    redactApiKeys: true
    maxResponseLength: 100000
```

### Custom Hooks

Implement your own logic:

```yaml
hooks:
  - type: request-logger
    enabled: true
    logDir: ~/.dexto/logs
```

## Hook Configuration Fields

**Core fields (all hooks):**

- **type** - Hook type identifier (resolved via the active image)
- **enabled** - Whether the hook is active (omit or set `true` to enable)

## Ordering

Hooks execute in the order they are provided in the `hooks:` array.

## Configuration Examples

### Security-Focused

```yaml
hooks:
  - type: content-policy
    enabled: true
    maxInputChars: 50000
    redactEmails: true
    redactApiKeys: true

  - type: response-sanitizer
    enabled: true
    redactEmails: true
    redactApiKeys: true
```

### With Custom Logging

```yaml
hooks:
  - type: request-logger
    enabled: true
    logDir: ~/.dexto/logs
    logFileName: request-logger.log

  - type: analytics
    enabled: true
    endpoint: https://analytics.example.com
    apiKey: $ANALYTICS_API_KEY
```

## Custom Hook Implementation

### Type-Only Imports (Recommended)

Custom hooks should use **type-only imports** from `@dexto/core`. This ensures types exist for IDE autocomplete and type-checking, but the runtime import disappears in compiled output. This avoids "two copies of core" issues and version skew:

```typescript
import type {
    Hook,
    BeforeLLMRequestPayload,
    BeforeResponsePayload,
    BeforeToolCallPayload,
    AfterToolResultPayload,
    HookResult,
    HookExecutionContext,
} from '@dexto/core';

export class MyHook implements Hook {
    private config: Record<string, unknown>;

    async initialize(config: Record<string, unknown>): Promise<void> {
        this.config = config;
    }

    async beforeLLMRequest(
        payload: BeforeLLMRequestPayload,
        context: HookExecutionContext
    ): Promise<HookResult> {
        // Access context for logging and agent services
        context.logger.info(`Processing request: ${payload.text}`);

        // Validate or modify input
        return { ok: true };
    }

    async beforeToolCall(
        payload: BeforeToolCallPayload,
        context: HookExecutionContext
    ): Promise<HookResult> {
        // Check tool arguments before execution
        return { ok: true };
    }

    async afterToolResult(
        payload: AfterToolResultPayload,
        context: HookExecutionContext
    ): Promise<HookResult> {
        // Process tool results
        return { ok: true };
    }

    async beforeResponse(
        payload: BeforeResponsePayload,
        context: HookExecutionContext
    ): Promise<HookResult> {
        // Sanitize/format final response
        return { ok: true };
    }

    async cleanup(): Promise<void> {
        // Release resources
    }
}

export default MyHook;
```

### Arrow Function Properties (Type Inference)

For shorter syntax with automatic type inference, use arrow function property assignments:

```typescript
import type { Hook, HookResult } from '@dexto/core';

export class MyHook implements Hook {
    // Types are inferred from the Hook interface
    beforeToolCall = async (payload, context): Promise<HookResult> => {
        // payload is BeforeToolCallPayload, context is HookExecutionContext
        return { ok: true };
    };
}
```

### Runtime Imports (Advanced)

If your hook needs **runtime imports** from `@dexto/core` (not just types), ensure your agent directory has `@dexto/core` installed and pinned to match your CLI version exactly. Otherwise, you risk runtime version mismatches:

```bash
# In your agent directory, pin to match CLI version
pnpm add --save-exact @dexto/core@<cli-version>
```

Most hooks only need type-only imports and the execution context provided at runtime.

## Hook Results

```typescript
// Success
return { ok: true };

// Success with modifications
return {
    ok: true,
    modify: { text: 'modified input' },
    notices: [{ kind: 'info', code: 'modified', message: 'Input modified' }],
};

// Failure (blocks execution)
return {
    ok: false,
    cancel: true,
    message: 'Validation failed',
};
```

## Best Practices

1. **Order hooks intentionally** - Validators before processors, sanitizers last
2. **Keep logging non-blocking** - Don't halt on logging failures
3. **Use cancel for security** - Content policy hooks should cancel on violations
4. **Keep hooks focused** - Single responsibility per hook
5. **Handle errors gracefully** - Return appropriate results
6. **Clean up resources** - Implement cleanup() properly

## Hook Examples

### Built-in Hooks

- **[Content Policy Hook](https://github.com/truffle-ai/dexto/blob/main/packages/core/src/hooks/builtins/content-policy.ts)** - Input validation and content filtering
- **[Response Sanitizer Hook](https://github.com/truffle-ai/dexto/blob/main/packages/core/src/hooks/builtins/response-sanitizer.ts)** - Output sanitization and PII redaction

### Custom Hook Examples

- **[Request Logger Hook](https://github.com/truffle-ai/dexto/blob/main/packages/image-logger-agent/src/hooks/request-logger.ts)** - Complete custom hook implementation with logging

## See Also

- [agent.yml Reference → Hooks](./agent-yml.md#hooks) - Complete field documentation
- [System Prompt Configuration](./systemPrompt.md) - Configure agent behavior
