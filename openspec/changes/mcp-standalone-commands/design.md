## Context

The CLI currently registers only `mcp --group-servers`. The existing MCP manager supports independent connections, tool descriptors, prompts and resources.

## Goals / Non-Goals

Goals: independent MCP configuration and one-shot operations with explicit server identity and closed ownership.

Non-goals: agent bootstrap, new permission engine, persisted daemon connections, browser OAuth setup, changing Core policy or hosted applications.

## Decisions

- Store MCP servers in `.dexto/mcp.yml` by default, with explicit `--config` override. This avoids model/config resolution. Preserve unrelated YAML nodes and comments when editing.
- Validate stored values without expanding templates; reuse Core runtime validation when connecting. Writing expanded credentials would corrupt portable setup and leak secrets.
- Reuse the existing manager. Resolve calls by explicit server name and upstream tool descriptor rather than ambiguous aliases. Direct calls are operator-authorized operations, outside agent approval policy.
- Each operation creates its own manager and disconnects it in `finally`. `connect` reports a completed probe with closed connection ownership rather than implying a daemon.
- Return exit 2 for configuration/usage, 3 for connection failures and 4 for tool/protocol operations. Avoid raw connection error text in output because it can contain configured credentials.

## Risks / Trade-offs

Configured commands execute local programs and may contact remote servers; operators own endpoint access and credentials. MCP interactive authentication and elicitation are not provided by these noninteractive commands. One-shot calls do not persist sessions.

## Setup and gateway interfaces

Typed command/argument/environment and URL/header options make setup discoverable to agents; JSON remains the full-contract escape hatch. All forms preserve literal templates. Standalone commands bypass analytics wrappers because raw tool arguments and server configuration can contain credentials. JSON stdout remains independent of logs.

The aggregation parent command accepts an explicit MCP-only file through the same loader, preserving its legacy agent fallback when absent. It binds signal/EOF shutdown only after initialization and chains the existing server close callback with listener disposal in `finally`. The aggregation handler remains the sole owner of downstream/upstream connection and logger cleanup.

Direct calls use the selected existing Core client's public SDK connection after descriptor-based argument validation so exact upstream names and MCP `isError` results remain intact. No alternate MCP engine or permission policy is introduced.
