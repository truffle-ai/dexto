# Proposal

## Why

Interrupting a one-shot MCP command currently terminates the CLI before its connection cleanup runs. A stdio server that remains alive after EOF can be left running.

## What Changes

- Own SIGINT and SIGTERM inside one-shot MCP operations, preserve the first signal, and return a safe interrupted outcome after connection/logger cleanup.
- Cancel active SDK requests, including direct Core tool calls, without changing permissions or execution duration policy.
- During startup, mark interruption and wait for existing connection/discovery settlement before closing; never invoke the requested operation afterward.
- Remove owned process listeners after success, failure or interruption.

## Capabilities

### New Capabilities

- `standalone-mcp-interruption`: cancellation outcomes and owned cleanup for one-shot MCP commands.

### Modified Capabilities

None.

## Impact

CLI operation ownership, process regressions and public documentation only. Core remains process-signal-free and uses its existing direct-call API. No dependency, hosted policy, agent runtime, Cloud repository or daemon changes. Forced process termination and remote operation rollback are outside this contract.
