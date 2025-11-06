# @dexto/observability

Modern observability dashboard for Dexto agents with clean architecture and SaaS-like UX.

## Quick Start

### 1. Start Dashboard Server

```bash
cd packages/observability
node dist/bin/dexto-dashboard.js
```

Dashboard runs on **http://localhost:3002**

### 2. Configure Agent

Add to your `agents/default-agent.yml`:

```yaml
telemetry:
  enabled: true
  export:
    type: otlp
    protocol: http
    endpoint: http://localhost:4318/v1/traces
```

### 3. View Dashboard

Open **http://localhost:3002** in your browser.

## Dashboard Features

### Overview
- Agent health status and uptime
- Key metrics (traces, latency, error rate, requests)
- Storage health (database, cache, blob)
- Latency distribution (P50, P95, P99, Mean)
- Token usage by provider
- Tool call statistics and success rates

### Sessions
- Session-based activity view
- Session metrics (messages, duration, errors, tool calls)
- Drill-down into individual session traces

### Traces
- Detailed trace inspection with filtering
- Filter by session, provider, model, tool, time window
- Full trace details with attributes
- Status tracking and error messages

### Tools
- Tool performance metrics
- Success rates per tool
- Average duration tracking
- Top tools by usage

### Errors
- Error tracking and grouping
- Error rate monitoring
- Affected sessions
- Recent error timeline

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
cd dashboard && pnpm dev
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
