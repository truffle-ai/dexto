---
sidebar_position: 3
---

# Plugins Configuration

Dexto's plugin system allows you to extend agent behavior with custom logic that runs at specific points in the request/response lifecycle. Plugins can validate, modify, or monitor data as it flows through your agent.

## Hook Points

Plugins can inject custom logic at four key points in the agent lifecycle:

- **beforeLLMRequest** - Before user input reaches the LLM (validate input, block inappropriate requests, log incoming messages)
- **beforeToolCall** - Before a tool executes (validate arguments, enforce permissions, audit tool usage)
- **afterToolResult** - After a tool completes (process results, handle errors, transform outputs)
- **beforeResponse** - Before sending the response to the user (redact sensitive data, format output, log responses)

## Common Use Cases

- **Security & Compliance**: Content filtering, PII redaction, input validation, rate limiting
- **Observability**: Request/response logging, performance monitoring, usage analytics
- **Data Transformation**: Input preprocessing, output formatting, multi-language translation
- **Business Logic**: Custom validation rules, workflow enforcement, cost tracking

## Type Definition

```typescript
export type PluginsConfig = {
    // Built-in plugins (optional)
    contentPolicy?: {
        priority: number;
        blocking?: boolean;
        enabled?: boolean;
        maxInputChars?: number;
        redactEmails?: boolean;
        redactApiKeys?: boolean;
    };
    responseSanitizer?: {
        priority: number;
        blocking?: boolean;
        enabled?: boolean;
        redactEmails?: boolean;
        redactApiKeys?: boolean;
        maxResponseLength?: number;
    };
    // Custom plugins
    custom?: Array<{
        name: string;
        module: string;
        enabled: boolean;
        blocking: boolean;
        priority: number;
        config?: Record<string, any>;
    }>;
};
```

## Plugin Configuration Fields

### Core Fields (All Plugins)

- **priority** (number): Execution order (lower numbers run first). Typical ranges:
  - 1-99: Pre-processing plugins (validation, logging)
  - 100-899: Main processing plugins
  - 900-999: Post-processing plugins (sanitization, formatting)

- **blocking** (boolean): If `true`, plugin errors will halt execution and return an error to the user. If `false`, errors are logged but execution continues.

- **enabled** (boolean): Whether the plugin is active. Defaults to `true`.

### Custom Plugin Fields

- **name** (string): Unique identifier for the plugin
- **module** (string): Path to the plugin module file (supports `${{dexto.agent_dir}}` substitution)
- **config** (object, optional): Plugin-specific configuration passed to the plugin's `initialize()` method

## Built-in Plugins

Dexto includes two built-in plugins for common security and content management needs:

### Content Policy Plugin

Enforces content policies on incoming user requests, including abusive language detection, input length limits, and sensitive data redaction.

```yaml
plugins:
  contentPolicy:
    priority: 10          # Run early to validate input
    blocking: true        # Block requests that violate policy
    enabled: true
    maxInputChars: 50000  # Truncate input exceeding this length (0 = no limit)
    redactEmails: true    # Replace email addresses with [redacted-email]
    redactApiKeys: true   # Redact potential API keys from input
```

**Features:**
- Blocks requests containing abusive language (always enabled)
- Truncates input exceeding `maxInputChars` (with warning)
- Redacts email addresses if `redactEmails: true`
- Redacts API keys and tokens if `redactApiKeys: true`

### Response Sanitizer Plugin

Sanitizes LLM responses before they're sent to users, preventing accidental leakage of sensitive information.

```yaml
plugins:
  responseSanitizer:
    priority: 900              # Run late to clean final output
    blocking: false            # Don't halt on sanitization errors
    enabled: true
    redactEmails: true         # Replace email addresses with [redacted-email]
    redactApiKeys: true        # Redact potential API keys from responses
    maxResponseLength: 100000  # Truncate responses exceeding this length (0 = no limit)
```

**Features:**
- Redacts email addresses from responses
- Redacts API keys, tokens, and secrets from responses
- Truncates responses exceeding `maxResponseLength` (with warning)

## Custom Plugins

Custom plugins allow you to implement your own logic at various points in the agent lifecycle.

### Plugin Configuration

```yaml
plugins:
  custom:
    - name: request-logger
      module: "${{dexto.agent_dir}}/plugins/request-logger.ts"
      enabled: true
      blocking: false  # Non-blocking - we just observe, don't interfere
      priority: 5      # Run early to capture original data
      config:
        logDir: ~/.dexto/logs
        logFileName: request-logger.log
```

### Module Path Substitution

The `module` field supports the `${{dexto.agent_dir}}` variable for agent-relative paths:

```yaml
# Relative to agent directory
module: "${{dexto.agent_dir}}/plugins/my-plugin.ts"

# Absolute path also works
module: "/absolute/path/to/plugin.ts"
```

**Path Resolution:**
- `${{dexto.agent_dir}}` resolves to the directory containing your agent's YAML file
- This makes plugins portable when sharing agent configurations
- Absolute paths work but are less portable

### Plugin Implementation

Custom plugins must implement the `DextoPlugin` interface:

```typescript
import type {
    DextoPlugin,
    BeforeLLMRequestPayload,
    BeforeResponsePayload,
    BeforeToolCallPayload,
    AfterToolResultPayload,
    PluginResult,
    PluginExecutionContext,
} from '@core/plugins/types.js';

export class MyPlugin implements DextoPlugin {
    private config: any;

    // Called once when plugin is registered
    async initialize(config: Record<string, any>): Promise<void> {
        this.config = config;
        // Setup resources, open files, etc.
    }

    // Called before each LLM request
    async beforeLLMRequest(
        payload: BeforeLLMRequestPayload,
        context: PluginExecutionContext
    ): Promise<PluginResult> {
        // Validate, modify, or log user input
        return { ok: true };
    }

    // Called before each tool execution
    async beforeToolCall(
        payload: BeforeToolCallPayload,
        context: PluginExecutionContext
    ): Promise<PluginResult> {
        // Validate, modify, or log tool calls
        return { ok: true };
    }

    // Called after each tool execution
    async afterToolResult(
        payload: AfterToolResultPayload,
        context: PluginExecutionContext
    ): Promise<PluginResult> {
        // Process, modify, or log tool results
        return { ok: true };
    }

    // Called before response is sent to user
    async beforeResponse(
        payload: BeforeResponsePayload,
        context: PluginExecutionContext
    ): Promise<PluginResult> {
        // Validate, modify, or log LLM responses
        return { ok: true };
    }

    // Called when plugin is unregistered or agent shuts down
    async cleanup(): Promise<void> {
        // Close files, release resources, etc.
    }
}

// Export the plugin class as default
export default MyPlugin;
```

### Plugin Results

Plugins return a `PluginResult` object to control execution:

```typescript
// Success - continue execution
return { ok: true };

// Success with modifications
return {
    ok: true,
    modify: { text: 'modified input' },  // Modify payload fields
    notices: [{
        kind: 'info',
        code: 'my_plugin.modified',
        message: 'Input was modified',
    }],
};

// Failure - block execution (if plugin is blocking)
return {
    ok: false,
    cancel: true,
    message: 'Validation failed',
    notices: [{
        kind: 'block',
        code: 'my_plugin.validation_failed',
        message: 'Input validation failed',
    }],
};
```

## Plugin Lifecycle

Plugins execute in priority order at specific extension points:

1. **beforeLLMRequest**: Before user input is sent to the LLM
   - Validate or modify user input (text, images, files)
   - Block inappropriate requests
   - Log incoming requests

2. **beforeToolCall**: Before a tool is executed
   - Validate tool arguments
   - Log tool usage
   - Modify tool parameters

3. **afterToolResult**: After a tool completes
   - Process or log tool results
   - Modify tool output
   - Handle tool errors

4. **beforeResponse**: Before the LLM response is sent to the user
   - Sanitize sensitive information
   - Log responses
   - Modify response content

### Execution Order

Plugins execute in priority order (lowest to highest). If multiple plugins have the same priority, execution order is undefined.

```yaml
plugins:
  custom:
    - name: validator
      priority: 10    # Runs first
      blocking: true

    - name: logger
      priority: 50    # Runs second
      blocking: false

    - name: sanitizer
      priority: 900   # Runs last
      blocking: false
```

## Blocking vs Non-blocking Plugins

### Blocking Plugins (`blocking: true`)

- Plugin errors **halt execution** immediately
- Failed validation **prevents** the request from continuing
- User receives an error message
- Use for: Security validation, content policy enforcement, critical business rules

```yaml
plugins:
  contentPolicy:
    blocking: true  # Block abusive content
```

### Non-blocking Plugins (`blocking: false`)

- Plugin errors are **logged but execution continues**
- Useful for monitoring, logging, and optional features
- Failures don't impact user experience
- Use for: Logging, metrics, analytics, optional enhancements

```yaml
plugins:
  custom:
    - name: request-logger
      blocking: false  # Don't fail if logging breaks
```

## Complete Configuration Example

```yaml
plugins:
  # Built-in content validation
  contentPolicy:
    priority: 10
    blocking: true
    enabled: true
    maxInputChars: 50000
    redactEmails: true
    redactApiKeys: true

  # Built-in response sanitization
  responseSanitizer:
    priority: 900
    blocking: false
    enabled: true
    redactEmails: true
    redactApiKeys: true
    maxResponseLength: 100000

  # Custom plugins
  custom:
    # Early logging - capture original data
    - name: request-logger
      module: "${{dexto.agent_dir}}/plugins/request-logger.ts"
      enabled: true
      blocking: false
      priority: 5
      config:
        logDir: ~/.dexto/logs
        logFileName: request-logger.log

    # Custom validation - runs after content policy
    - name: custom-validator
      module: "${{dexto.agent_dir}}/plugins/custom-validator.ts"
      enabled: true
      blocking: true
      priority: 20
      config:
        strictMode: true
        allowedDomains:
          - example.com
          - trusted.org

    # Analytics - non-blocking observation
    - name: analytics
      module: "${{dexto.agent_dir}}/plugins/analytics.ts"
      enabled: true
      blocking: false
      priority: 100
      config:
        endpoint: https://analytics.example.com
        apiKey: $ANALYTICS_API_KEY
```

## Best Practices

1. **Use appropriate priorities**: Validators before processors, sanitizers last
2. **Make logging non-blocking**: Don't halt execution if logging fails
3. **Use blocking for security**: Content policy and validation should be blocking
4. **Keep plugins focused**: Each plugin should have a single, clear responsibility
5. **Handle errors gracefully**: Return appropriate `PluginResult` based on severity
6. **Use agent-relative paths**: Use `${{dexto.agent_dir}}` for portability
7. **Clean up resources**: Implement `cleanup()` to release resources properly

## Next Steps

- **Explore system prompts**: Configure agent behavior with [System Prompt Configuration](./systemPrompt.md)
- **Connect tools**: Add MCP servers with [MCP Configuration](../../mcp/configuration.md)
- **Storage options**: Configure message persistence with [Storage Configuration](./storage.md)
