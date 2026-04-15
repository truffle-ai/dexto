---
'@dexto/core': patch
'@dexto/agent-config': patch
'@dexto/agent-management': patch
---

Expose host-owned runtime IDs cleanly through core runtime flows.

Hosts can now provide runtime-owned IDs through core agent runtime configuration,
and those IDs are propagated consistently through runtime events, hooks, sessions,
and telemetry baggage and span attributes.
