# @dexto/observability

Production-ready observability dashboard for Dexto agents with comprehensive telemetry and clean architecture.

## Quick Start

### 1. Start Dashboard Server

```bash
cd packages/observability
node dist/bin/dexto-dashboard.js
```

Dashboard runs on **http://localhost:3002**

### 2. Configure & Start Agent

Telemetry is already enabled in `agents/default-agent.yml`:

```yaml
telemetry:
  enabled: true
  export:
    type: otlp
    protocol: http
    endpoint: http://localhost:4318/v1/traces
```

Start your agent:
```bash
dexto server
```

### 3. View Dashboard

Open **http://localhost:3002** and use your agent to generate telemetry.

## Dashboard Features

### Overview
- **Agent activity status** - Shows if agent is actively processing requests
- **Key metrics** - Requests, avg latency, error rate, token usage (24h)
- **Latency distribution** - P50, P95, P99, Mean percentiles
- **LLM usage** - Total tokens and breakdown by provider (Vercel/OpenAI/Anthropic)
- **Top tools** - Most frequently used MCP tools with call counts
- **Auto-refresh** - Updates every 10 seconds

### Sessions & Trace Groups
- **Activity grouping** - Groups spans by sessionId or traceId
- **Session metrics** - Span count, total/avg duration, error count/rate
- **Drill-down** - Click any group to see all spans within that session
- **Group types** - Sessions (has sessionId) vs Trace Groups (related spans)
- **Auto-refresh** - Updates every 10 seconds

### Traces
- **Category filters** - All, Agent, LLM, or MCP Tools with live counts
- **Color-coded** - Blue (agent), Green (LLM), Purple (tools)
- **Time windows** - Last hour, 24 hours, or 7 days
- **Full details** - sessionId, provider, model, toolName, attributes
- **Auto-refresh** - Updates every 10 seconds

### Tools
- **MCP tool tracking** - Actual user-facing tools (Read, Write, Bash, Grep, etc.)
- **Performance** - Total calls, success rate, avg duration per tool
- **Usage ranking** - Tools sorted by frequency
- **Success rates** - Percentage of successful vs failed executions

### Errors
- **Error grouping** - Groups by message for pattern detection
- **Impact analysis** - Affected sessions and occurrence counts
- **Recent timeline** - Latest errors with full context

## What's Captured

The dashboard shows **complete context** for all agent operations:

### Session Context
- ✅ **sessionId** - Propagated from `agent.run()` to all child spans via OpenTelemetry baggage
- ✅ Groups all activity within a session for debugging

### LLM Metadata
- ✅ **provider** - Which LLM provider (vercel, openai, anthropic)
- ✅ **model** - Which model (claude-3-5-sonnet, gpt-4, etc.)
- ✅ **Token usage** - Input, output, reasoning, total (gen_ai.usage.* conventions)

### MCP Tool Executions
- ✅ **tool.name** - Actual tool name (Read, Write, Bash, Grep, Glob, etc.)
- ✅ **tool.server** - MCP server providing the tool
- ✅ **Arguments & results** - Full execution details (truncated for large data)

### Span Hierarchy
- ✅ **Parent-child relationships** - Proper traceId and parentSpanId
- ✅ **Baggage propagation** - Context flows: agent → LLM → tools
- ✅ **Timing** - Precise start/end timestamps and duration

## Architecture

```
packages/observability/
├── src/                    # Backend (Node.js)
│   ├── api/               # Query & metrics services
│   ├── server/            # OTLP receiver + dashboard server
│   ├── storage/           # Telemetry storage & retention
│   └── bin/               # CLI entry point
├── dashboard/             # Frontend (Vite + React + Tailwind)
│   ├── src/
│   │   ├── components/   # Reusable UI (Card, Table, Badge, etc.)
│   │   ├── pages/        # Main pages (Overview, Sessions, Traces, Tools, Errors)
│   │   ├── lib/          # Hooks & types
│   │   └── App.tsx       # Main app with navigation
│   └── package.json
└── dist/
    ├── server/           # Built backend
    └── dashboard-ui/     # Built frontend (served by backend)
```

## Tech Stack

**Backend:**
- Node.js + TypeScript
- Hono (web framework)
- OpenTelemetry (OTLP receiver)
- SQLite (storage)

**Frontend:**
- Vite (build tool)
- React 18
- TypeScript
- Tailwind CSS 3

## Development

### Build Everything
```bash
pnpm build              # Build backend + frontend
pnpm build:lib          # Build backend only
pnpm build:dashboard    # Build frontend only
```

### Development Mode
```bash
# Terminal 1: Start backend
node dist/bin/dexto-dashboard.js

# Terminal 2: Frontend dev server (optional)
cd ../observability-dashboard && pnpm dev
```

## API Endpoints

- `GET /api/health` - System health and trace count
- `GET /api/traces?sessionId=...&provider=...&window=24h` - List traces
- `GET /api/traces/:id` - Get trace details
- `GET /api/metrics?window=24h` - Aggregated metrics

## Environment Variables

```bash
DASHBOARD_PORT=3002    # Dashboard UI port
OTLP_PORT=4318        # OTLP receiver port (Jaeger compatible)
DASHBOARD_DB=./.dexto/observability.db  # Database path
```

## Clean Architecture Principles

✅ **No Duplication** - Single source of truth for UI
✅ **Clear Separation** - Backend in `src/`, frontend in `dashboard/`
✅ **Modern Stack** - Vite + React + Tailwind for fast, maintainable UI
✅ **Type Safety** - Full TypeScript coverage
✅ **Low Entropy** - Clean, organized structure
