---
sidebar_position: 9
sidebar_label: "Telemetry"
---

# Telemetry Configuration

Enable distributed tracing to monitor agent behavior, debug issues, and track performance using OpenTelemetry.

:::tip Complete Reference
For complete field documentation, backend setup, and collector configuration, see **[agent.yml → Telemetry](./agent-yml.md#telemetry-configuration)**.
:::

## Overview

Telemetry provides visibility into your agent's operations through distributed tracing. When enabled, Dexto automatically traces agent operations, LLM calls, and tool executions.

**What you get:**
- Complete request lifecycle traces
- LLM token usage tracking
- Tool execution monitoring
- Export to any OTLP-compatible backend

## Quick Start

### 1. Start Jaeger (Local)

```bash
docker run -d \
  --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

### 2. Configure Agent

```yaml
telemetry:
  enabled: true
  serviceName: my-agent
  export:
    type: otlp
    endpoint: http://localhost:4318/v1/traces
```

### 3. View Traces

Open [http://localhost:16686](http://localhost:16686) and explore your traces.

## Configuration Options

```yaml
telemetry:
  enabled: boolean              # Turn on/off (default: false)
  serviceName: string           # Service identifier in traces
  tracerName: string            # Tracer name (default: 'dexto-tracer')
  export:
    type: 'otlp' | 'console'    # Export destination
    protocol: 'http' | 'grpc'   # OTLP protocol (default: 'http')
    endpoint: string            # Backend URL
    headers:                    # Optional auth headers
      [key: string]: string
```

## Export Types

### OTLP (Production)

Export to OTLP-compatible backends:

```yaml
telemetry:
  enabled: true
  serviceName: my-prod-agent
  export:
    type: otlp
    endpoint: http://localhost:4318/v1/traces
```

### Console (Development)

Print traces to terminal:

```yaml
telemetry:
  enabled: true
  export:
    type: console
```

## Common Configurations

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

### Grafana Cloud

```yaml
telemetry:
  enabled: true
  serviceName: my-prod-agent
  export:
    type: otlp
    endpoint: https://otlp-gateway-prod.grafana.net/otlp
    headers:
      authorization: "Basic $GRAFANA_CLOUD_TOKEN"
```

### Honeycomb

```yaml
telemetry:
  enabled: true
  serviceName: my-prod-agent
  export:
    type: otlp
    endpoint: https://api.honeycomb.io:443
    headers:
      x-honeycomb-team: $HONEYCOMB_API_KEY
```

## What Gets Traced

Dexto automatically traces:
- **Agent operations** - Full request lifecycle
- **LLM calls** - Model invocations with token counts
- **Tool executions** - Tool calls and results

**Key attributes:**
- `gen_ai.usage.input_tokens` - Prompt tokens
- `gen_ai.usage.output_tokens` - Completion tokens
- `llm.provider` - Provider name
- `llm.model` - Model identifier

## Use Cases

| Scenario | How Telemetry Helps |
|----------|---------------------|
| **Debug slow requests** | Identify bottlenecks in traces |
| **Monitor token usage** | Track LLM costs and optimize prompts |
| **Production monitoring** | Set alerts for errors and latency |
| **Performance optimization** | Find inefficient operations |

## Performance Impact

Minimal overhead:
- ~1-2ms per span
- Async export (non-blocking)
- Automatic batching

For high-volume agents, consider sampling or using a collector.

## Best Practices

1. **Enable in production** - Essential for observability
2. **Use meaningful service names** - Different names per deployment
3. **Set up monitoring** - Create alerts for issues
4. **Consider sampling** - For high-traffic scenarios
5. **Use collectors** - For advanced processing and buffering

## See Also

- [agent.yml Reference → Telemetry](./agent-yml.md#telemetry-configuration) - Complete field documentation
- [OpenTelemetry Docs](https://opentelemetry.io/docs/) - Official OTEL documentation
- [Jaeger Docs](https://www.jaegertracing.io/docs/) - Jaeger tracing platform
