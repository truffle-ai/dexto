---
sidebar_position: 10
---

# Plugins Configuration

Extend agent behavior with custom logic that runs at specific points in the request/response lifecycle.

:::tip Complete Reference
For complete field documentation, plugin interfaces, and implementation details, see **[agent.yml → Plugins](./agent-yml.md#plugins)**.
:::

## Overview

Dexto's plugin system allows you to inject custom logic at four key lifecycle points: before LLM requests, before tool calls, after tool results, and before responses.

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

## Plugin Types

### Built-in Plugins

**contentPolicy** - Enforce content policies on input:

```yaml
plugins:
    contentPolicy:
        priority: 10
        blocking: true
        enabled: true
        maxInputChars: 50000
        redactEmails: true
        redactApiKeys: true
```

**responseSanitizer** - Clean responses before sending:

```yaml
plugins:
    responseSanitizer:
        priority: 900
        blocking: false
        enabled: true
        redactEmails: true
        redactApiKeys: true
        maxResponseLength: 100000
```

### Custom Plugins

Implement your own logic:

```yaml
plugins:
    custom:
        - name: request-logger
          module: '${{dexto.agent_dir}}/plugins/request-logger.ts'
          enabled: true
          blocking: false
          priority: 5
          config:
              logDir: ~/.dexto/logs
```

## Plugin Configuration Fields

**Core fields (all plugins):**

- **priority** - Execution order (1-99: pre-processing, 100-899: main, 900-999: post)
- **blocking** - If true, errors halt execution
- **enabled** - Whether plugin is active

**Custom plugin fields:**

- **name** - Unique identifier
- **module** - Path to plugin file (supports `${{dexto.agent_dir}}`)
- **config** - Plugin-specific configuration

## Priority Ordering

Plugins execute in priority order (lowest first):

```yaml
plugins:
    custom:
        - name: validator
          priority: 10 # Runs first
          blocking: true
        - name: logger
          priority: 50 # Runs second
          blocking: false
        - name: sanitizer
          priority: 900 # Runs last
          blocking: false
```

## Blocking vs Non-blocking

**Blocking (`blocking: true`):**

- Errors halt execution
- User sees error message
- Use for: Security, validation, critical rules

**Non-blocking (`blocking: false`):**

- Errors logged but execution continues
- Use for: Logging, metrics, optional features

## Configuration Examples

### Security-Focused

```yaml
plugins:
    contentPolicy:
        priority: 10
        blocking: true
        enabled: true
        maxInputChars: 50000
        redactEmails: true
        redactApiKeys: true

    responseSanitizer:
        priority: 900
        blocking: false
        enabled: true
        redactEmails: true
        redactApiKeys: true
```

### With Custom Logging

```yaml
plugins:
    custom:
        - name: request-logger
          module: '${{dexto.agent_dir}}/plugins/request-logger.ts'
          blocking: false
          priority: 5
          config:
              logDir: ~/.dexto/logs
              logFileName: request-logger.log

        - name: analytics
          module: '${{dexto.agent_dir}}/plugins/analytics.ts'
          blocking: false
          priority: 100
          config:
              endpoint: https://analytics.example.com
              apiKey: $ANALYTICS_API_KEY
```

## Custom Plugin Implementation

```typescript
import type {
    DextoPlugin,
    BeforeLLMRequestPayload,
    PluginResult,
    PluginExecutionContext,
} from '@dexto/core';

export class MyPlugin implements DextoPlugin {
    private config: any;

    async initialize(config: Record<string, any>): Promise<void> {
        this.config = config;
    }

    async beforeLLMRequest(
        payload: BeforeLLMRequestPayload,
        context: PluginExecutionContext
    ): Promise<PluginResult> {
        // Validate or modify input
        return { ok: true };
    }

    async cleanup(): Promise<void> {
        // Release resources
    }
}

export default MyPlugin;
```

## Plugin Results

```typescript
// Success
return { ok: true };

// Success with modifications
return {
    ok: true,
    modify: { text: 'modified input' },
    notices: [{ kind: 'info', code: 'modified', message: 'Input modified' }],
};

// Failure (blocks if plugin is blocking)
return {
    ok: false,
    cancel: true,
    message: 'Validation failed',
};
```

## Best Practices

1. **Use appropriate priorities** - Validators before processors, sanitizers last
2. **Make logging non-blocking** - Don't halt on logging failures
3. **Use blocking for security** - Content policy should be blocking
4. **Keep plugins focused** - Single responsibility per plugin
5. **Handle errors gracefully** - Return appropriate results
6. **Use agent-relative paths** - `${{dexto.agent_dir}}` for portability
7. **Clean up resources** - Implement cleanup() properly

## Plugin Examples

### Built-in Plugins

- **[Content Policy Plugin](https://github.com/truffle-ai/dexto/blob/main/packages/core/src/plugins/content-policy-plugin.ts)** - Input validation and content filtering
- **[Response Sanitizer Plugin](https://github.com/truffle-ai/dexto/blob/main/packages/core/src/plugins/response-sanitizer-plugin.ts)** - Output sanitization and PII redaction

### Custom Plugin Examples

- **[Request Logger Plugin](https://github.com/truffle-ai/dexto/blob/main/agents/logger-agent/plugins/request-logger.ts)** - Complete custom plugin implementation with logging

## See Also

- [agent.yml Reference → Plugins](./agent-yml.md#plugins) - Complete field documentation
- [System Prompt Configuration](./systemPrompt.md) - Configure agent behavior
