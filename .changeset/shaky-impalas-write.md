---
'@dexto/webui': patch
'@dexto/core': patch
'dexto': patch
---

**Features:**
- Agent switcher now supports file-based agents loaded via CLI (e.g., `dexto --agent path/to/agent.yml`)
- Agent selector UI remembers recent agents (up to 5) with localStorage persistence
- WebUI displays currently active file-based agent and recent agent history
- Dev server (`pnpm dev`) now auto-opens browser when WebUI is ready
- Added `/test-api` custom command for automated API test coverage analysis

**Bug Fixes:**
- Fixed critical bug where Memory, A2A, and MCP API routes used stale agent references after switching
- Fixed telemetry shutdown blocking agent switches when observability infrastructure (Jaeger/OTLP) is unavailable
- Fixed dark mode styling issues when Chrome's Auto Dark Mode is enabled
- Fixed agent card not updating for A2A and MCP routes after agent switch

**Improvements:**
- Refactored `Dexto.createAgent()` to static method, removing unnecessary singleton pattern
- Improved error handling for agent switching with typed errors (CONFLICT error type, `AgentError.switchInProgress()`)
- Telemetry now disabled by default (opt-in) in default agent configuration
- Added localStorage corruption recovery for recent agents list
