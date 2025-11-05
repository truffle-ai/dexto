---
'@dexto/agent-management': patch
'@dexto/analytics': patch
'@dexto/server': patch
'@dexto/webui': patch
'@dexto/core': patch
'dexto': patch
---

UI refactor with TanStack Query, new agent management package, and Hono as default server

**Server:**
- Make Hono the default API server (use `DEXTO_USE_EXPRESS=true` env var to use Express)
- Fix agentId propagation to Hono server for correct agent name display
- Fix circular reference crashes in error logging by using structured logger context

**WebUI:**
- Integrate TanStack Query for server state management with automatic caching and invalidation
- Add centralized query key factory and API client with structured error handling
- Replace manual data fetching with TanStack Query hooks across all components
- Add Zustand for client-side persistent state (recent agents in localStorage)
- Add keyboard shortcuts support with react-hotkeys-hook
- Add optimistic updates for session management via WebSocket events
- Fix Dialog auto-close bug in CreateMemoryModal
- Add defensive null handling in MemoryPanel
- Standardize Prettier formatting (single quotes, 4-space indentation)

**Agent Management:**
- Add `@dexto/agent-management` package for centralized agent configuration management
- Extract agent registry, preferences, and path utilities into dedicated package

**Internal:**
- Improve build orchestration and fix dependency imports
- Add `@dexto/agent-management` to global CLI installation
