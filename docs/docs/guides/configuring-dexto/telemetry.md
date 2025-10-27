---
sidebar_position: 9
sidebar_label: "Telemetry"
---

# Telemetry Configuration

Telemetry provides distributed tracing to help you understand agent behavior, debug issues, and monitor performance using OpenTelemetry.

```yaml
telemetry:
  enabled: true
  serviceName: my-agent
  export:
    type: otlp
    endpoint: http://localhost:4318/v1/traces
```

## What You Get

When enabled, Dexto automatically traces:
- **Agent operations** - Complete request lifecycle (agent.run, etc.)
- **LLM calls** - Model invocations with token usage (input/output tokens)
- **Tool executions** - Tool calls and results

Traces are exported to any OTLP-compatible backend (Jaeger, Grafana Cloud, Honeycomb, etc.).

## Configuration Options

### Basic Configuration

```yaml
telemetry:
  enabled: boolean              # Turn telemetry on/off (default: false)
  serviceName: string           # Service identifier in traces
  tracerName: string            # Tracer name (default: 'dexto-tracer')
  export:
    type: 'otlp' | 'console'    # Export destination
    protocol: 'http' | 'grpc'   # OTLP protocol (default: 'http')
    endpoint: string            # Backend URL
    headers:                    # Optional auth headers
      [key: string]: string
```

### Field Reference

**`enabled`** (boolean, default: `false`)
Enable or disable telemetry. No overhead when disabled.

**`serviceName`** (string, default: agent name)
Identifies your agent in trace backends. Use different names for different deployments.

**`tracerName`** (string, default: `'dexto-tracer'`)
Internal tracer identifier. Usually doesn't need customization.

**`export.type`** (`'otlp'` | `'console'`)
- `'otlp'` - Export to OTLP backend (production)
- `'console'` - Print traces to terminal (development only)

**`export.protocol`** (`'http'` | `'grpc'`, default: `'http'`)
OTLP transmission protocol. HTTP is simpler, gRPC is more efficient.

**`export.endpoint`** (string)
URL of your OTLP collector or backend:
- HTTP: `http://localhost:4318/v1/traces`
- gRPC: `http://localhost:4317`

**`export.headers`** (object, optional)
Authentication headers for cloud backends:
```yaml
headers:
  authorization: "Bearer ${API_TOKEN}"
```

## Quick Start with Jaeger

The easiest way to visualize traces locally:

### 1. Start Jaeger

```bash
docker run -d \
  --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

### 2. Configure Agent

```yaml
# agents/my-agent.yml
telemetry:
  enabled: true
  serviceName: my-agent
  export:
    type: otlp
    endpoint: http://localhost:4318/v1/traces
```

### 3. View Traces

1. Run your agent and send messages
2. Open http://localhost:16686
3. Select your service name
4. Explore traces

## Configuration Examples

### Development (Console Output)

```yaml
telemetry:
  enabled: true
  export:
    type: console  # Print to terminal
```

### Local Jaeger

```yaml
telemetry:
  enabled: true
  serviceName: my-dev-agent
  export:
    type: otlp
    protocol: http
    endpoint: http://localhost:4318/v1/traces
```

### Production (Grafana Cloud)

```yaml
telemetry:
  enabled: true
  serviceName: my-prod-agent
  export:
    type: otlp
    endpoint: https://otlp-gateway-prod.grafana.net/otlp
    headers:
      authorization: "Basic ${GRAFANA_CLOUD_TOKEN}"
```

### Production (Honeycomb)

```yaml
telemetry:
  enabled: true
  serviceName: my-prod-agent
  export:
    type: otlp
    endpoint: https://api.honeycomb.io:443
    headers:
      x-honeycomb-team: ${HONEYCOMB_API_KEY}
```

### With OpenTelemetry Collector

For advanced processing (sampling, filtering, multi-backend export):

```yaml
telemetry:
  enabled: true
  serviceName: my-agent
  export:
    type: otlp
    endpoint: http://otel-collector:4318/v1/traces  # Point to collector
```

See `otel-collector-config.yaml` in the project root for collector configuration examples.

## Understanding Traces

### Trace Structure

A typical agent request creates nested spans:

```
agent.run (5.2s)
  ├─ llm.vercel.completeTask (4.8s)
  │  └─ llm.vercel.streamText (4.8s)
  │     └─ POST https://api.openai.com/... (4.7s)
  └─ tool.executeTool (0.4s)
```

### Key Attributes

Look for these in your traces:
- `gen_ai.usage.input_tokens` - Prompt tokens
- `gen_ai.usage.output_tokens` - Completion tokens
- `llm.provider` - Provider (openai, anthropic, etc.)
- `llm.model` - Model used (gpt-4, claude-sonnet-4-5, etc.)

## Common Use Cases

### Debug Slow Requests
Filter traces by duration to find bottlenecks:
- Is the delay in LLM calls?
- Are tool executions taking too long?
- Where is time being spent?

### Monitor Token Usage
Track LLM costs by examining token attributes:
- Which operations use the most tokens?
- Are prompts too large?
- Can context be optimized?

### Production Monitoring
Set up alerts for:
- High latency requests
- Error rates
- Excessive token usage

## Troubleshooting

### No traces appearing?
- Check `enabled: true` in config
- Verify backend is running (e.g., `docker ps | grep jaeger`)
- Confirm endpoint URL matches backend
- Look for errors in console logs

### Only seeing HTTP spans?
This is normal - HTTP auto-instrumentation captures API calls. Filter by operation name (e.g., `agent.run`) to see decorated spans.

## Performance Impact

Telemetry has minimal overhead:
- ~1-2ms per span
- Async export (non-blocking)
- Automatic batching

For high-volume production agents, consider:
- Sampling (capture 10% of traces)
- Using a collector for buffering
- Filtering at the collector level

## Best Practices

**Development**
- Enable early to understand behavior
- Use `type: console` for quick debugging
- Check traces after implementing features

**Production**
- Always enable for observability
- Use meaningful service names per deployment
- Set up monitoring and alerts
- Consider sampling for high traffic

## Learn More

- [Complete agent.yml Reference](./agent-yml.md#telemetry-configuration)
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
