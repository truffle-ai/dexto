## Context

MCP configuration, provider messages and capability data are not safe diagnostic fields. Existing Core tool-call logging already avoids tool arguments and results, but connection, prompt, resource and lifecycle logs still include raw values.

## Decision

Remove raw fields at the MCP logging call sites. Retain operation messages, explicitly selected names and fixed `MCPErrorCode` classifications appropriate to the failed operation. Do not inspect arbitrary errors for a code, redact strings heuristically, or introduce another logging service.

For stdio connections without an alias, use a transport label rather than the command line. Remote connection logs use the selected alias/name rather than the URL. Transport and auth-provider inputs are unchanged.

## Compatibility and limits

Returned values, exception messages and recorded connection errors remain available to callers. `getServerInfo()` still exposes raw command, arguments and environment; `getServerConfig()` and failed-connection inspection likewise return caller-owned data. They must not be serialized as public status output. Local `getConnectionStatus()` is not a remote-health probe.

Chosen server, tool and prompt identifiers remain log metadata, so applications should keep secrets out of those names. Server-owned stderr and application/SDK logging outside Core MCP call sites are not rewritten. This change adds no generic secret redactor or authority policy.

## Validation

Sentinel-based mock-logger regressions inspect every logger level while asserting unchanged results, errors, events and approvals. Real stdio processes cover command arguments, environment and resource notifications; real loopback HTTP/SSE cover URLs and response errors. Existing lifecycle and manager tests remain required. Build/consumer checks and the full quality gate are coordinated before publication.
