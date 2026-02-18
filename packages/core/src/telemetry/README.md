# Telemetry Module

OpenTelemetry distributed tracing for Dexto agent operations.

## What It Does

- **Traces execution flow** across DextoAgent, LLM services, and tool operations
- **Captures token usage** for all LLM calls (input/output/total tokens)
- **Exports to OTLP-compatible backends** (Jaeger, Grafana, etc.)
- **Zero overhead when disabled** - all instrumentation is opt-in

## Architecture

### Decorator-Based Instrumentation

Uses `@InstrumentClass` decorator on critical execution paths:

- `DextoAgent` - Top-level orchestrator
- `VercelLLMService` - LLM operations (all providers via Vercel AI SDK)
- `ToolManager` - Tool execution

**Not decorated** (following selective instrumentation strategy):
- Low-level services (MCPManager, SessionManager, PluginManager)
- Storage/memory operations (ResourceManager, MemoryManager)

### Initialization

Telemetry is initialized in `createAgentServices()` **before** any decorated classes are instantiated:

```typescript
// packages/core/src/utils/service-initializer.ts
if (config.telemetry?.enabled) {
    await Telemetry.init(config.telemetry);
}
```

### Agent Switching

For sequential agent switching, telemetry is shut down before creating the new agent:

```typescript
// packages/cli/src/api/server-hono.ts
await Telemetry.shutdownGlobal(); // Old telemetry
// Construct a new agent (createAgentServices() will init fresh telemetry if enabled)
newAgent = await createAgentFromId(agentId);
```

## Configuration

Enable in your agent config:

```yaml
# agents/my-agent.yml
telemetry:
  enabled: true
  serviceName: my-dexto-agent
  tracerName: dexto-tracer
  export:
    type: otlp
    protocol: http
    endpoint: http://localhost:4318/v1/traces
```

## Testing with Jaeger

### 1. Start Jaeger

```bash
docker run -d \
  --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

**Ports:**
- `16686` - Jaeger UI (web interface)
- `4318` - OTLP HTTP receiver (where Dexto sends traces)

### 2. Enable Telemetry

Telemetry is already enabled in `agents/default-agent.yml`. To disable, set `enabled: false`.

### 3. Run Dexto webUI

```bash
# Run in CLI mode
bun run dev
```

### 4. Generate Traces

Send messages through CLI or WebUI to generate traces.

### 5. View Traces

1. Open Jaeger UI: http://localhost:16686
2. Select service: `dexto-default-agent`
3. Click "Find Traces"
4. Select an operation: `agent.run`

### 6. Verify Trace Structure

Click on a trace to see the span hierarchy:

```
agent.run                              (20.95s total)
  ├─ agent.maybeGenerateTitle          (14.99ms)
  └─ llm.vercel.completeTask           (20.93s)
      └─ llm.vercel.streamText         (20.92s)
          ├─ POST https://api.openai.com/... (10.01s)  ← HTTP auto-instrumentation
          └─ POST https://api.openai.com/... (10.79s)  ← HTTP auto-instrumentation
```

**What to verify:**
- ✅ Span names use correct prefixes (`agent.`, `llm.vercel.`)
- ✅ Span hierarchy shows parent-child relationships
- ✅ HTTP auto-instrumentation captures API calls
- ✅ Token usage attributes: `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`
- ✅ No errors in console logs

### 7. Cleanup

```bash
docker stop jaeger
docker rm jaeger
```

## Module Structure

```
telemetry/
├── README.md           # This file
├── telemetry.ts        # Core Telemetry class, SDK initialization
├── decorators.ts       # @InstrumentClass decorator implementation
├── schemas.ts          # Zod schemas for telemetry config
├── types.ts            # TypeScript types for spans and traces
├── exporters.ts        # CompositeExporter for multi-destination support
└── utils.ts            # Helper functions
```

## Key Files

### `telemetry.ts`
- `Telemetry.init(config)` - Initialize OpenTelemetry SDK
- `Telemetry.shutdownGlobal()` - Shutdown for agent switching
- `Telemetry.get()` - Get initialized instance

### `decorators.ts`
- `@InstrumentClass(options)` - Decorator for automatic tracing
- `withSpan(spanName, fn, options)` - Manual span creation

### `exporters.ts`
- `CompositeExporter` - Multi-destination exporting with recursive telemetry filtering

## Adding Telemetry to New Modules

Use the `@InstrumentClass` decorator on classes in critical execution paths:

```typescript
import { InstrumentClass } from '../telemetry/decorators.js';

@InstrumentClass({
    prefix: 'mymodule',           // Span prefix: mymodule.methodName
    excludeMethods: ['helper']     // Methods to skip
})
export class MyModule {
    async process(data: string): Promise<void> {
        // Span automatically created: "mymodule.process"
        // Add custom attributes to active span:
        const span = trace.getActiveSpan();
        if (span) {
            span.setAttribute('data.length', data.length);
        }
    }
}
```

## Troubleshooting

**No traces appearing in Jaeger?**
1. Verify Jaeger is running: `docker ps | grep jaeger`
2. Check endpoint in agent config: `http://localhost:4318/v1/traces`
3. Check console for "Telemetry initialized" log
4. Verify `enabled: true` in telemetry config

**Only seeing HTTP GET/POST spans?**
- These are from OpenTelemetry's automatic HTTP instrumentation (expected!)
- Filter by Operation: `agent.run` to see decorated spans
- Click into a trace to see the full hierarchy

**Build errors?**
- Run `bun install` if dependencies are missing
- Ensure you're on the `telemetry` branch

## Further Documentation

- Full feature plan: `/feature-plans/telemetry.md`
- Configuration options: See `schemas.ts`
- OpenTelemetry docs: https://opentelemetry.io/docs/
