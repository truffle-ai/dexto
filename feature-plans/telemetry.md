# Telemetry Feature Plan

**Status**: In Development
**Branch**: `telemetry`
**Target Release**: TBD
**Last Updated**: 2025-10-24

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Decisions](#architecture-decisions)
3. [Implementation Plan](#implementation-plan)
4. [Technical Details](#technical-details)
5. [User-Facing Features](#user-facing-features)
6. [Testing Strategy](#testing-strategy)
7. [Documentation Requirements](#documentation-requirements)

---

## Overview

### Goals

Add OpenTelemetry (OTel) distributed tracing to Dexto for observability and debugging.

**Key Features:**
- Distributed tracing across agent operations, LLM calls, tool executions, and MCP operations
- Token usage tracking and attribution
- Optional collector-based processing for advanced use cases
- Direct export to Jaeger, Grafana, or other OTLP-compatible backends

**Non-Goals (Future Work):**
- Metrics collection (counters, gauges, histograms)
- Structured logs with trace correlation
- Built-in trace visualization in WebUI (Phase 2)

---

## Architecture Decisions

### 1. Decorator-Based Instrumentation (Selective Approach)

**Decision**: Use `@InstrumentClass` decorators ONLY on critical execution paths (orchestration + LLM + tools).

**Rationale - Based on Mastra Research**:
- Mastra only decorates 5 high-level classes (Agent, Mastra orchestrator, Voice, TTS, Auth)
- LLM and tool operations traced manually in Mastra, but we use decorators for simplicity
- Storage/Memory/Session layers NOT decorated in Mastra (too low-level, too much noise)
- Selective approach = better signal-to-noise ratio in traces
- Lower overhead in production

**Classes to Decorate** (Critical Execution Paths):
- ✅ `DextoAgent` - Top-level orchestrator (like Mastra's Agent)
- ✅ `VercelLLMService` - LLM operations (Mastra traces manually, we use decorator for simplicity)
- ✅ `OpenAILLMService` - LLM operations
- ✅ `AnthropicLLMService` - LLM operations
- ✅ `ToolManager` - Tool execution (Mastra traces manually, we use decorator for simplicity)

**Classes NOT Decorated** (Following Mastra's Pattern):
- ❌ `MCPManager` - Internal communication layer (too low-level)
- ❌ `SessionManager` - Lifecycle management (not critical path)
- ❌ `PluginManager` - Hook execution (internal)
- ❌ `ResourceManager` - File operations (not critical path)
- ❌ `MemoryManager` - Storage operations (not critical path)

**Why This Approach**:
1. **Critical path visibility**: Agent orchestration, LLM calls, tool execution are where issues occur
2. **Performance**: Fewer decorators = less overhead
3. **Signal-to-noise**: Focus traces on user-facing operations, not internal plumbing
4. **Proven pattern**: Mastra uses similar selective approach successfully
5. **Future extensibility**: Can add manual spans to other areas if needed

**Session ID Propagation via Baggage**:
Session ID is not available in all services (e.g., DextoAgent manages multiple sessions), so we use OpenTelemetry Baggage for propagation:

```typescript
// In DextoAgent.run() - set session_id in baggage for propagation
const span = trace.getActiveSpan();
if (span) {
    span.setAttribute('session_id', targetSessionId);

    // Propagate via baggage to all child spans
    const baggageEntries = { session_id: { value: targetSessionId } };
    const ctx = propagation.setBaggage(
        context.active(),
        propagation.createBaggage(baggageEntries)
    );
    // Execute in this context - all child spans inherit baggage
}
```

**Example Decorated Class**:
```typescript
@InstrumentClass({
  prefix: 'agent',
  excludeMethods: ['isStarted', 'isStopped', 'getConfig'],
  skipIfNoTelemetry: true
})
export class DextoAgent {
  async run(textInput: string, ...): Promise<string> {
    // Decorator creates span automatically
    // Add extra attributes to existing span
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttribute('input.length', textInput.length);
      span.setAttribute('has_image', Boolean(imageDataInput));
    }

    return await this.llmService.completeTask(textInput, ...);
  }
}
```

Decorators already support reading baggage values - see `decorators.ts:166-177`.

### 2. Manual Span Attributes for Token Usage

**Decision**: Don't use `onFinish` callback - manually add token usage to spans after awaiting promises.

**Rationale**:
- Dexto already awaits `response.text`, `response.totalUsage`, etc.
- Event-driven architecture with `sessionEventBus.emit` is well-established
- Simpler to add attributes after await than inject callbacks
- Less intrusive to existing codebase
- **Note**: Vercel AI SDK DOES support `onFinish`, but we're keeping our current flow

**Implementation**:
```typescript
// In VercelLLMService.streamText()
const [finalText, usage, reasoningText] = await Promise.all([
    response.text,
    response.totalUsage,
    response.reasoningText,
]);

// Add telemetry attributes AFTER awaiting (simpler approach)
const span = trace.getActiveSpan();
if (span) {
    span.setAttribute('llm.usage.input_tokens', usage.inputTokens || 0);
    span.setAttribute('llm.usage.output_tokens', usage.outputTokens || 0);
    span.setAttribute('llm.usage.total_tokens', usage.totalTokens || 0);
    if (usage.reasoningTokens) {
        span.setAttribute('llm.usage.reasoning_tokens', usage.reasoningTokens);
    }
}

// Keep existing event emission unchanged
this.sessionEventBus.emit('llmservice:response', { ... });
return finalText;
```

**Why not use `onFinish`**:
- Our code structure already has the await + emit pattern working well
- Adding `onFinish` would be an additional pattern to maintain
- Decorators can still work with our current approach
- Less refactoring needed

### 3. Telemetry Initialization in Service Layer

**Decision**: Initialize telemetry in `createAgentServices()` BEFORE creating any decorated services.

**Rationale**:
- Decorators need OpenTelemetry SDK initialized before class instantiation
- `createAgentServices()` has access to validated agent config
- Matches Dexto's config-driven architecture
- Clean lifecycle: telemetry init/shutdown tied to agent lifecycle
- Supports sequential switching with different telemetry configs per agent

**IMPORTANT**: This is a **CHANGE** from INSTRUCTIONS.md approach, which initialized in `DextoAgent.start()` AFTER services were created.

**Implementation**:
```typescript
// packages/core/src/utils/service-initializer.ts
export async function createAgentServices(
    config: ValidatedAgentConfig,
    configPath?: string
): Promise<AgentServices> {
    // 0. Initialize telemetry FIRST (before any decorated classes instantiated)
    if (config.telemetry?.enabled) {
        await Telemetry.init(config.telemetry);
        logger.debug('Telemetry initialized');
    }

    // 1. Initialize event bus
    const agentEventBus: AgentEventBus = new AgentEventBus();

    // 2. Initialize storage
    const storageManager = await createStorageManager(config.storage);

    // 3-12. ... rest of services (decorators now work)

    return { mcpManager, toolManager, ... };
}
```

**Agent Switching Support**:
```typescript
// Sequential telemetry shutdown/init during agent switching
async function switchAgentById(agentId: string) {
    // 1. Shutdown old telemetry FIRST
    await Telemetry.shutdownGlobal();

    // 2. Create new agent (will init fresh telemetry in createAgentServices)
    newAgent = await getDexto().createAgent(agentId);
    await newAgent.start();  // ← Fresh telemetry with new config

    // 3. Stop old agent (telemetry already shut down)
    await previousAgent.stop();
}
```

**Benefits**:
- ✅ Each agent can have different telemetry config (endpoint, protocol, etc.)
- ✅ Clean sequential switching - no config conflicts
- ✅ Brief gap (~100ms) during switching is acceptable
- ✅ Supports current one-agent-at-a-time architecture

### 4. Configuration: App Export Only (No Processor Config)

**Decision**: Dexto's agent config only handles export configuration, NOT processor/collector configuration.

**Rationale**:
- **Separation of concerns**: App exports data, collector processes it
- **Simplicity**: Processor configs are complex and belong in infrastructure
- **Deployment flexibility**: Collector config is deploy-time, app config is runtime
- **Multi-app scenarios**: One collector can serve multiple Dexto instances

**App Config** (what we support):
```yaml
# agents/default-agent.yml
telemetry:
  enabled: true
  serviceName: my-dexto-agent
  tracerName: dexto-tracer

  # Export configuration
  export:
    type: otlp
    protocol: http
    endpoint: http://localhost:4318
    headers:
      authorization: "Bearer ${OTLP_API_KEY}"  # Optional
```

**Collector Config** (separate file, optional):
```yaml
# otel-collector-config.yaml (for OpenTelemetry Collector binary)
receivers:
  otlp:
    protocols:
      http:
        endpoint: "localhost:4318"

processors:
  batch:
    timeout: 5s
  tail_sampling:
    policies:
      - name: errors-only
        type: status_code

exporters:
  otlp/jaeger:
    endpoint: jaeger:4317

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, tail_sampling]
      exporters: [otlp/jaeger]
```

### 5. Two Deployment Modes

**Mode 1: Direct Export (Simple)**
```
Dexto App → Jaeger/Grafana/etc. (direct)
```

**Mode 2: Collector-Based (Advanced)**
```
Dexto App → OTel Collector → Multiple Backends
                          ├─ Jaeger (traces)
                          ├─ Prometheus (metrics - future)
                          └─ CloudWatch/Datadog/etc.
```

Users choose based on their needs. Both are documented.

---

## Implementation Plan

### Phase 1: Core Telemetry Infrastructure ✅ COMPLETE

**What**:
- Port telemetry files from old branch
- Add to agent config schema
- Initialize in `DextoAgent.start()`
- Basic test that it works

**Status**: ✅ Done
- All telemetry files ported
- Config schema integrated
- Lifecycle hooks added
- Build passes

### Phase 2: Decorator Implementation ✅ COMPLETE

**Tasks**:

1. **Add decorators to all major services** (Following selective instrumentation strategy from Architecture Decisions)
   - [x] Add `@InstrumentClass` to `DextoAgent` (commit ae11e083)
     - Exclude methods: `isStarted`, `isStopped`, `getConfig`, `getEffectiveConfig`, etc.
   - [x] Add `@InstrumentClass` to `VercelLLMService` (commit ae11e083)
     - Exclude methods: `getConfig`, `getModelId`, `getProviderDisplayName`, etc.
   - [x] Add `@InstrumentClass` to `OpenAILLMService` (commit 81bf732a)
   - [x] Add `@InstrumentClass` to `AnthropicLLMService` (commit 81bf732a)
   - [x] Add `@InstrumentClass` to `ToolManager` (commit 558f7587)
     - Trace both MCP and internal tool executions

**NOT decorated** (per Architecture Decisions - lines 61-66):
   - ❌ `MCPManager` - Internal communication layer (too low-level)
   - ❌ `SessionManager` - Lifecycle management (not critical path)
   - ❌ `PluginManager` - Hook execution (internal)
   - ❌ `ResourceManager` - File operations (not critical path)
   - ❌ `MemoryManager` - Storage operations (not critical path)

2. **Add manual span attributes for key operations**
   - [x] In `VercelLLMService.streamText()`: (commit dd738b52)
     - Token usage (gen_ai.usage.input_tokens, gen_ai.usage.output_tokens)
   - [x] In `VercelLLMService.generateText()`: (commit dd738b52)
     - Same as streamText
   - [x] In `OpenAILLMService`: (commit dd738b52)
     - Token usage attributes
   - [x] In `AnthropicLLMService`: (commit dd738b52)
     - Token usage attributes

3. **Move telemetry initialization to service layer**
   - [x] Add telemetry init to TOP of `createAgentServices()` (service-initializer.ts:77)
   - [x] Add `Telemetry.shutdownGlobal()` static method (telemetry.ts:156)
   - [x] Update agent switching in `server.ts` to shutdown telemetry first (server.ts:158)
   - [x] Remove telemetry init from `DextoAgent.start()` (not in start, only in createAgentServices)
   - [x] Make `DextoAgent.stop()` idempotent for telemetry (DextoAgent.ts:321-324)

### Phase 3: Documentation & Examples 📝 PENDING

**Tasks**:

1. **User Documentation**
   - [ ] Create `docs/docs/observability/telemetry.md`
     - What is telemetry?
     - How to enable it
     - Configuration options
     - Direct export vs collector
   - [ ] Create `docs/docs/observability/jaeger-setup.md`
     - Installing Jaeger locally
     - Docker compose example
     - Viewing traces
   - [ ] Create `docs/docs/observability/collector-setup.md`
     - When to use a collector
     - Setup instructions
     - Example configs

2. **Developer Documentation**
   - [ ] Update `packages/core/src/telemetry/README.md`
     - Architecture overview
     - How decorators work
     - Adding telemetry to new modules
     - Testing telemetry

3. **Configuration Examples**
   - [ ] Update `agents/default-agent.yml` with telemetry section (commented out)
   - [ ] Improve `otel-collector-config.yaml` with better comments
   - [ ] Add `examples/telemetry/` directory:
     - `docker-compose.yml` (Jaeger + Collector)
     - `jaeger-only.yml` (direct export)
     - `grafana-cloud.yml` (cloud export)

### Phase 4: Testing 🧪 PENDING

**Tasks**:

1. **Unit Tests**
   - [ ] Test `Telemetry.init()` with different configs
   - [ ] Test decorator span creation
   - [ ] Test skipIfNoTelemetry flag
   - [ ] Test span attribute setting

2. **Integration Tests**
   - [ ] Test full agent run with telemetry enabled
   - [ ] Test LLM operations create spans
   - [ ] Test token usage attributes
   - [ ] Test telemetry disabled (no-op)
   - [ ] Test multiple agents sharing telemetry

3. **Manual Testing**
   - [ ] Run Jaeger locally
   - [ ] Execute agent tasks
   - [ ] Verify traces appear in Jaeger UI
   - [ ] Verify span hierarchy is correct
   - [ ] Verify attributes are captured

### Phase 5: Future Enhancements 🔮 FUTURE

**Not in this PR, but will be marked with TODO comments in code**:

1. **Metrics Collection** (TODO in relevant service files)
   - LLM call counters (by provider/model)
   - Token usage histograms
   - Request latency histograms
   - Active session gauges
   - Mark location: LLM services, ToolManager, SessionManager

2. **Structured Logs** (TODO in logger/)
   - OpenTelemetry logs with trace correlation
   - Replace/enhance current logger
   - Mark location: `packages/core/src/logger/`

3. **WebUI Integration** (TODO in WebUI components)
   - Trace visualization in Dexto WebUI
   - Real-time trace streaming
   - Token usage dashboard
   - Mark location: `packages/webui/src/`

4. **Advanced Sampling** (TODO in telemetry/schemas.ts)
   - Ratio-based sampling
   - Always-on/always-off strategies
   - Tail-based sampling (requires collector)
   - Mark location: `packages/core/src/telemetry/schemas.ts`, `telemetry.ts`

5. **Advanced Features** (TODO in appropriate modules)
   - Custom span processors
   - Context propagation across A2A calls
   - Cost tracking per trace
   - Mark location: `packages/core/src/telemetry/`

---

## Technical Details

### OpenTelemetry Concepts

#### 1. Traces & Spans

**Trace**: A request's complete journey through the system.
**Span**: A single operation within a trace (has start/end time).

```
Trace ID: abc123
  └─ agent.run (5.2s) ← Root span
      ├─ llm.completeTask (4.8s) ← Child span
      │   ├─ tool.executeTool[searchWeb] (1.2s)
      │   │   └─ mcp.callTool (1.1s)
      │   └─ (LLM generates response)
      └─ response.formatting (0.4s)
```

**Span Attributes**: Key-value metadata
- `agent.session_id`: "session-123"
- `llm.provider`: "openai"
- `llm.model`: "gpt-4"
- `llm.usage.total_tokens`: 450

**Span Events**: Point-in-time markers
- "Tool execution started"
- "Stream chunk received"

#### 2. Context Propagation

OpenTelemetry automatically links parent/child spans:

```typescript
// Parent span is automatically in context
const parentSpan = tracer.startSpan('parent');

// Child span automatically linked
const childSpan = tracer.startSpan('child');
```

#### 3. Exporters

Send telemetry data to backends:
- **ConsoleSpanExporter**: Print to console (dev only)
- **OTLPHttpExporter**: Send via HTTP to OTLP endpoint
- **OTLPGrpcExporter**: Send via gRPC to OTLP endpoint

#### 4. Collectors (Optional)

Separate service that receives, processes, and forwards telemetry:
- **Receivers**: Accept data (OTLP, Jaeger, Zipkin, etc.)
- **Processors**: Transform data (batching, sampling, filtering)
- **Exporters**: Send to backends (Jaeger, Prometheus, CloudWatch, etc.)

### Dexto Architecture Integration

#### Decorator Flow

```typescript
@InstrumentClass({ prefix: 'agent', skipIfNoTelemetry: true })
export class DextoAgent {
  async run(textInput: string): Promise<string> {
    // Decorator intercepts here:
    // 1. Check if telemetry enabled (skipIfNoTelemetry)
    // 2. Create span: "agent.run"
    // 3. Record input arguments as attributes
    // 4. Call original method ↓

    const result = await this.llmService.completeTask(textInput);

    // 5. Record result as attributes
    // 6. End span
    // 7. Return result
    return result;
  }
}
```

#### Nested Spans

```typescript
// DextoAgent (decorated)
async run() {
  // Span: "agent.run" starts

  // LLMService (decorated)
  await this.llmService.completeTask();
  // Span: "llm.completeTask" starts (child of agent.run)

  // ToolManager (future - decorated)
  await toolManager.executeTool();
  // Span: "tool.executeTool" starts (child of llm.completeTask)

  // Spans end in reverse order
}
```

#### Accessing Active Span

```typescript
import { trace } from '@opentelemetry/api';

const span = trace.getActiveSpan();
if (span) {
  span.setAttribute('custom.key', 'value');
  span.addEvent('Something happened');

  // Get trace ID for logging correlation
  const traceId = span.spanContext().traceId;
  logger.info('Processing', { traceId });
}
```

### Configuration Schema

```typescript
// packages/core/src/telemetry/schemas.ts
export const OtelConfigurationSchema = z.object({
  serviceName: z.string().optional(),
  enabled: z.boolean().optional(),
  tracerName: z.string().optional(),

  // TODO (Telemetry): Add sampling support
  // sampling: z.discriminatedUnion('type', [
  //   z.object({ type: z.literal('ratio'), probability: z.number().min(0).max(1) }),
  //   z.object({ type: z.literal('always_on') }),
  //   z.object({ type: z.literal('always_off') }),
  // ]).optional(),

  export: z.union([
    z.object({
      type: z.literal('otlp'),
      protocol: z.enum(['grpc', 'http']).optional(),
      endpoint: z.union([
        z.string().url(),
        z.string().regex(/^[\w.-]+:\d+$/), // host:port
      ]).optional(),
      headers: z.record(z.string()).optional(),
    }),
    z.object({
      type: z.literal('console'),
    }),
  ]).optional(),
});
```

---

## User-Facing Features

### How Users Enable Telemetry

#### 1. Basic Setup (Direct to Jaeger)

```yaml
# agents/my-agent.yml
telemetry:
  enabled: true
  serviceName: my-dexto-agent
  export:
    type: otlp
    protocol: http
    endpoint: http://localhost:4318
```

```bash
# Start Jaeger
docker run -d -p 16686:16686 -p 4318:4318 \
  jaegertracing/all-in-one:latest

# Run Dexto
dexto --agent my-agent
```

Open http://localhost:16686 to view traces.

#### 2. Advanced Setup (With Collector)

```yaml
# agents/my-agent.yml
telemetry:
  enabled: true
  serviceName: my-dexto-agent
  export:
    type: otlp
    endpoint: http://localhost:4318  # Send to collector
```

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: "localhost:4318"

processors:
  batch:
    timeout: 5s
  tail_sampling:
    policies:
      - name: slow-requests
        type: latency
        latency: {threshold_ms: 1000}

exporters:
  otlp/jaeger:
    endpoint: jaeger:4317
  otlp/grafana:
    endpoint: https://otlp-gateway.grafana.net
    headers:
      authorization: "Bearer ${GRAFANA_TOKEN}"

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, tail_sampling]
      exporters: [otlp/jaeger, otlp/grafana]
```

```bash
# Start collector
docker run -v $(pwd)/otel-collector-config.yaml:/etc/otel/config.yaml \
  -p 4318:4318 \
  otel/opentelemetry-collector:latest

# Start Jaeger
docker run -d -p 16686:16686 -p 4317:4317 \
  jaegertracing/all-in-one:latest

# Run Dexto
dexto --agent my-agent
```

#### 3. Disable Telemetry

```yaml
# agents/my-agent.yml
telemetry:
  enabled: false
```

Or omit the `telemetry` section entirely.

### What Users See in Jaeger

**Service**: `my-dexto-agent`

**Operations**:
- `agent.run`
- `llm.completeTask`
- (future) `tool.executeTool`
- (future) `mcp.callTool`

**Attributes**:
- `agent.session_id`
- `llm.provider`
- `llm.model`
- `llm.usage.input_tokens`
- `llm.usage.output_tokens`
- `llm.usage.total_tokens`

**Example Trace**:
```
my-dexto-agent: agent.run (5.2s)
  ├─ llm.provider: openai
  ├─ llm.model: gpt-4
  ├─ agent.session_id: session-abc123
  └─ llm.completeTask (4.8s)
      ├─ llm.usage.input_tokens: 250
      ├─ llm.usage.output_tokens: 200
      └─ llm.usage.total_tokens: 450
```

---

## Testing Strategy

### Unit Tests

**File**: `packages/core/src/telemetry/telemetry.test.ts`

Test cases:
- Telemetry.init() with valid config
- Telemetry.init() with enabled=false
- Telemetry.get() throws when not initialized
- Decorator creates spans
- skipIfNoTelemetry works correctly

### Integration Tests

**File**: `packages/core/src/telemetry/telemetry.integration.test.ts`

Test cases:
- Full agent run creates expected spans
- Token usage attributes captured
- Multiple agents share telemetry
- Telemetry disabled has no overhead

### Manual Testing with Jaeger

#### Step 1: Start Jaeger (Docker)

```bash
# Start Jaeger all-in-one (includes UI, collector, and storage)
docker run -d \
  --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# Verify it's running
docker ps | grep jaeger

# Open Jaeger UI in browser
open http://localhost:16686
```

**Ports:**
- `16686` - Jaeger UI (web interface)
- `4318` - OTLP HTTP receiver (where Dexto sends traces)

#### Step 2: Enable Telemetry in Agent Config

Telemetry is already enabled in `agents/default-agent.yml`:

```yaml
telemetry:
  serviceName: dexto-default-agent
  enabled: true
  tracerName: dexto-tracer
  export:
    type: otlp
    protocol: http
    endpoint: http://127.0.0.1:4318/v1/traces
```

To disable for production, set `enabled: false` or comment out the entire section.

#### Step 3: Build and Run Dexto

```bash
# Build the project
pnpm run build

# Run in CLI mode
pnpm run cli

# OR run in server mode (with WebUI)
pnpm run server:start
# Then open http://localhost:3000
```

#### Step 4: Generate Traces

Send some messages through CLI or WebUI:
```
> Hello, how are you?
> What tools do you have?
> List files in the current directory
```

#### Step 5: View Traces in Jaeger

1. **Open Jaeger UI**: http://localhost:16686
2. **Select Service**: In dropdown, choose `dexto-default-agent`
3. **Click "Find Traces"**
4. **Select an operation**: Choose `agent.run` to filter main operations

#### Step 6: Verify Trace Structure

Click on a trace to see the span hierarchy. You should see:

```
agent.run                              (20.95s total)
  ├─ agent.maybeGenerateTitle          (14.99ms)
  └─ llm.vercel.completeTask           (20.93s)
      └─ llm.vercel.streamText         (20.92s)
          ├─ POST https://api.openai.com/... (10.01s)  ← HTTP auto-instrumentation
          └─ POST https://api.openai.com/... (10.79s)  ← HTTP auto-instrumentation
```

**What to verify:**
- ✅ **Span names** use correct prefixes (`agent.`, `llm.vercel.`)
- ✅ **Span hierarchy** shows parent-child relationships
- ✅ **HTTP auto-instrumentation** captures API calls to OpenAI/Anthropic
- ✅ **Timing information** shows where time is spent
- ✅ **Tags/Attributes** include baggage values (session_id, etc.)
- ✅ **No errors** in Dexto console logs

#### Step 7: Test Agent Switching (Optional)

If testing server mode with multiple agents:

```bash
# Switch agents via API
curl -X POST http://localhost:3000/api/agents/switch \
  -H "Content-Type: application/json" \
  -d '{"agentId": "another-agent"}'

# Check logs - should see:
# "Shutting down telemetry for agent switch..."
# "Telemetry initialized"

# Verify new traces appear in Jaeger with new agent config
```

#### Step 8: Cleanup

```bash
# Stop and remove Jaeger
docker stop jaeger
docker rm jaeger

# Optional: Disable telemetry in agents/default-agent.yml
# Set enabled: false or comment out telemetry section
```

#### Troubleshooting

**No traces appearing?**
1. Verify Jaeger is running: `docker ps | grep jaeger`
2. Check endpoint: `http://127.0.0.1:4318/v1/traces`
3. Check Dexto logs for "Telemetry initialized"
4. Check browser console for errors

**Build errors?**
- Run `pnpm install` if dependencies are missing
- Ensure you're on the `telemetry` branch

**Only seeing GET/POST spans?**
- These are from HTTP auto-instrumentation (expected!)
- Filter by Operation: `agent.run` to see decorated spans
- Click into a trace to see the full hierarchy

#### What the Auto-Instrumentation Shows

The GET/POST spans you see are from OpenTelemetry's automatic HTTP instrumentation:

- **GET** spans: Incoming requests from WebUI to API server
- **POST** spans: Outgoing requests from Dexto to LLM APIs (OpenAI, Anthropic, etc.)

This is **expected behavior** and provides valuable visibility into:
- Network latency
- API response times
- Request/response patterns

To disable auto-instrumentation, modify `telemetry.ts`:
```typescript
// Remove this line:
instrumentations: [getNodeAutoInstrumentations()],

// Replace with:
instrumentations: [],
```

### Manual Testing Checklist

- [ ] Start Jaeger in Docker
- [ ] Verify Jaeger UI accessible at http://localhost:16686
- [ ] Telemetry enabled in agent config
- [ ] Build project: `pnpm run build`
- [ ] Run Dexto (CLI or server mode)
- [ ] Send messages to generate traces
- [ ] Open Jaeger UI and select service
- [ ] Verify span hierarchy:
  - [ ] `agent.run` appears as root span
  - [ ] `llm.vercel.streamText` appears as child span
  - [ ] HTTP POST spans show OpenAI API calls
- [ ] Check span attributes and timing
- [ ] Test agent switching (if in server mode)
- [ ] Cleanup: Stop Jaeger container

---

## Documentation Requirements

### User Documentation

**Location**: `docs/docs/observability/`

Files:
1. **telemetry.md** - Overview and configuration
2. **jaeger-setup.md** - Local Jaeger setup
3. **collector-setup.md** - Collector setup (advanced)
4. **troubleshooting.md** - Common issues

### Developer Documentation

**Location**: `packages/core/src/telemetry/README.md`

Content:
- Architecture overview
- How to add telemetry to new modules
- Decorator usage patterns
- Testing telemetry code

### Configuration Examples

**Location**: `examples/telemetry/`

Files:
1. **docker-compose-jaeger.yml** - Jaeger only
2. **docker-compose-full.yml** - Jaeger + Collector
3. **grafana-cloud.yml** - Cloud export example
4. **agent-config-examples.yml** - Various telemetry configs

---

## Open Questions

1. **Sampling**: Should we implement sampling in Phase 2 or defer to Phase 5?
   - **Decision**: DEFERRED to Phase 5. Mark with TODO comments in code.

2. **WebUI Integration**: In-scope for this PR or future work?
   - **Decision**: Future work (Phase 5). Short-term: link out to Jaeger. Long-term: custom UI like Mastra.

3. **Metrics**: When to add metrics collection?
   - **Decision**: Phase 5 (after traces are solid). Mark with TODO comments.

4. **Context Propagation**: Do we need custom propagation for event bus?
   - **Decision**: Use OpenTelemetry Baggage for session_id propagation (already supported in decorators).

5. **Agent Switching**: How to handle different telemetry configs?
   - **Decision**: Sequential shutdown/init. Brief gap (~100ms) is acceptable.

---

## Success Criteria

**Phase 2 Complete When**:
- [ ] All core classes decorated
- [ ] Token usage captured in spans
- [ ] Telemetry initialized globally
- [ ] Build passes
- [ ] Tests pass
- [ ] Manual testing successful in Jaeger

**Ready for PR When**:
- [ ] Phase 2 complete
- [ ] Phase 3 complete (documentation)
- [ ] Phase 4 complete (testing)
- [ ] Quality checks pass
- [ ] Code reviewed

---

## WebUI Integration Options (Future Phase)

### Current State
- Telemetry exports to external tools (Jaeger, Grafana, etc.)
- No built-in trace visualization in Dexto WebUI
- Users must use external UIs to view traces

### Mastra's Approach

Mastra built a **custom trace visualization system** directly into their dev UI rather than embedding external tools like Jaeger.

**Key Components:**
1. **Storage**: AISpanRecord data model with hierarchical parent-child relationships
2. **API**: REST endpoints to query traces with filtering and pagination
3. **UI Components**:
   - TracesList - Table view of all traces
   - TraceDialog - Detail viewer with timeline
   - TraceTimeline - Gantt-chart-like visualization showing span duration and offset
   - SpanDetails - Side panel with attributes, events, token usage
   - TokenUsage - Token breakdown by provider/model

**Architecture Flow:**
```
Mastra App (OTel) → Database → REST API → React UI Components
```

**Visualization Features:**
- Hierarchical tree structure (parent-child spans)
- Interactive timeline with visual bars (percentage-based width/offset)
- Hover cards with latency details
- Token usage breakdown (supports both V5 and legacy formats)
- Real-time updates (auto-refetch every 3 seconds)
- Filtering by entity, date range, span type
- Can still export to OTLP for external tools

**File Reference:**
- `/mastra/packages/playground-ui/src/domains/observability/components/trace-dialog.tsx`
- `/mastra/packages/playground-ui/src/domains/observability/components/trace-timeline-span.tsx`

### Options for Dexto WebUI

#### Option 1: Custom Trace UI (Like Mastra)
**Pros:**
- Complete control over UI/UX
- Tight integration with Dexto's WebUI design
- Can show Dexto-specific context (session, agent state)
- No external dependencies for visualization

**Cons:**
- Significant development effort
- Need to implement hierarchical span tree, timeline visualization
- Need to store traces in Dexto's database
- Maintenance burden for UI components

**Implementation Requirements:**
- Store OTel spans in database (new schema)
- REST API to query traces
- React components for visualization
- Timeline component with Gantt-chart-like bars
- Token usage displays

#### Option 2: Embed Jaeger UI (iFrame)
**Pros:**
- Zero development - just embed existing UI
- Full-featured trace viewer
- Industry-standard tool

**Cons:**
- Need to run Jaeger backend
- iFrame sandboxing issues
- Less integrated with Dexto's design
- Limited customization

**Implementation:**
```tsx
// In WebUI
<iframe
  src="http://localhost:16686/trace/{traceId}"
  width="100%"
  height="600px"
/>
```

#### Option 3: Query OTLP Directly (Lightweight)
**Pros:**
- No database storage needed
- Query traces directly from OTLP endpoint
- Moderate development effort

**Cons:**
- Depends on external OTLP backend
- Limited querying capabilities (OTLP is for export, not querying)
- Most OTLP receivers don't support queries

**Note**: This option is not viable - OTLP is unidirectional (push only).

#### Option 4: Link Out to External UI
**Pros:**
- Minimal development
- Users can choose their preferred tool (Jaeger, Grafana, etc.)
- No maintenance burden

**Cons:**
- Context switch for users
- Less integrated experience
- Requires users to set up external tools

**Implementation:**
```tsx
// In WebUI - show link with trace ID
<a href={`http://localhost:16686/trace/${traceId}`} target="_blank">
  View trace in Jaeger
</a>
```

### Recommendation

**Short-term (Current PR)**: Option 4 - Link out to Jaeger
- Minimal effort
- Users who want observability are likely familiar with Jaeger
- Allows us to validate telemetry implementation first

**Long-term (Future Phase)**: Option 1 - Custom UI (like Mastra)
- Better user experience
- Tight integration with Dexto's session management
- Can show token costs, session context, agent state
- Aligns with Dexto's goal of being a complete development platform

**Implementation Plan**:
1. Phase 5: Add trace ID to WebUI responses
2. Phase 5: Add "View in Jaeger" links
3. Phase 6: Store spans in Dexto database (new schema)
4. Phase 6: Build custom trace visualization UI
5. Phase 6: Build token usage dashboard

### Key Learnings from Mastra

1. **Don't embed Jaeger** - Build custom UI for better UX
2. **Store spans in your database** - Enables rich querying and filtering
3. **Focus on AI-specific attributes** - Token usage, costs, model info
4. **Real-time updates** - Auto-refresh for dev experience
5. **Hierarchical visualization** - Essential for understanding trace flow
6. **Timeline is key** - Visual bars help spot bottlenecks quickly

---

## Today's Session Notes (2025-10-24)

### Key Decisions Made

1. **Reconciled with INSTRUCTIONS.md**:
   - OLD approach: Initialize telemetry in `DextoAgent.start()`
   - NEW approach: Initialize at application entry points (CLI, Server, SDK)
   - Reason: Telemetry is global infrastructure, should be shared across agents

2. **Hybrid Instrumentation**:
   - Use `@InstrumentClass` decorators for broad coverage
   - Add manual span attributes for specific details (token usage)
   - Keep current event-driven architecture with `sessionEventBus`

3. **Streaming Response Telemetry**:
   - Don't use `onFinish` callbacks (even though Vercel AI SDK supports them)
   - Manually add span attributes after awaiting promises
   - Simpler and less disruptive to existing code

4. **Configuration Separation**:
   - Dexto app config: Export only (WHERE to send data)
   - Collector config: Processing (HOW to transform data)
   - Keeps concerns separate and configs simple

5. **WebUI Integration**:
   - Short-term: Link out to Jaeger (minimal effort)
   - Long-term: Build custom UI like Mastra (better UX)
   - Study Mastra's implementation for reference

### Changes from Original Plan

- Moved telemetry initialization from DextoAgent to global entry points
- Clarified that `onFinish` is available but we're not using it
- Added WebUI integration options and recommendations
- Referenced Mastra's custom visualization approach

---

## References

- [OpenTelemetry Specification](https://opentelemetry.io/docs/specs/otel/)
- [OpenTelemetry JavaScript SDK](https://opentelemetry.io/docs/languages/js/)
- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
- [OTLP Specification](https://opentelemetry.io/docs/specs/otlp/)
- [Mastra Telemetry Implementation](../mastra/packages/core/src/telemetry/)
- [Mastra Dev UI Trace Visualization](../mastra/packages/playground-ui/src/domains/observability/)
