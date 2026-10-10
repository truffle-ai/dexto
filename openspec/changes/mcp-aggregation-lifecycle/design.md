## Context

See proposal.md for the failures. Core owns upstream connection construction and discovery; the CLI owns the downstream MCP server and its lifetime. Core aliases can change as connections change, and its Dexto tool adapter intentionally converts MCP error results into exceptions.

## Goals / Non-Goals

Keep the existing initializer and return type, and provide one cleanup path for all acquired host resources. Preserve the underlying MCP wire contract without rebuilding JSON Schema as Zod. Do not duplicate Core connection or authorization engines.

## Decisions

- Use Core MCPManager for connection ownership and existing tool aliases. Snapshot raw SDK discovery from connected clients, bind every advertised alias to its exact upstream client/name, and reject aliases missing or inconsistent with that discovery. This prevents stale manager cache changes from redirecting requests.
- Reject duplicate prompt names at startup rather than silently choosing the last connection. Retain existing qualified resource URIs and raw resource metadata.
- Use the low-level server request schemas and SDK forwarding for tools, prompts and resources. This preserves raw schemas, metadata and error results; pass each request's abort signal to the bound SDK client.
- Override the returned MCP server's close method with one shared cleanup promise and connect transport-close notification to it. Cleanup attempts server, manager and logger independently; preserve the original startup error after rollback.
- Suppress upstream diagnostic payload logging in the aggregation logger. The protocol transport must receive only protocol messages; caller-owned diagnostics may report safe startup status.

## Risks / Trade-offs

- Upstream discovery changes after startup → a deliberate fixed snapshot of first-page discovery; restart the aggregation host to refresh capabilities. Pagination and resource templates remain outside this slice.
- Existing ambiguous server, tool, resource or prompt configurations → fail visibly at startup; rename upstream prompts or separate hosts.
- Core candidate cleanup during failed connection → consume the separately validated Core cleanup fix before final validation, rather than duplicate that logic here.
- Upstream authorization and cancellation behavior vary → preserve SDK semantics and test local real protocol cancellation; no additional grants are implied.

## Migration Plan

Ship as a CLI patch with focused protocol regressions. Existing valid configurations and the return type remain usable. Revert the handler patch if needed; no persisted data or shared Core behavior changes are introduced by this host slice.
