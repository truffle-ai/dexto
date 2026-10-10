---
sidebar_label: Standalone MCP CLI
sidebar_position: 9
---

# Standalone MCP CLI

Use `dexto mcp` to configure, discover and call MCP servers without an agent, model credentials or Dexto login. Commands use `.dexto/mcp.yml` in the current directory by default. Supply `--config <path>` on each command to select another MCP-only YAML file.

## Add an existing server

For a local stdio server:

```bash
dexto mcp add local --command node --arg ./server.mjs --json
dexto mcp add portable --command node --arg ./server.mjs --env 'SERVICE_TOKEN=${SERVICE_TOKEN}' --json
```

Repeat `--arg` and `--env` as needed. Use `--arg=--flag` when an argument starts with `--`.

For a remote HTTP server:

```bash
dexto mcp add remote --url https://example.com/mcp --header 'Authorization=Bearer ${SERVICE_TOKEN}' --json
```

Repeat `--header` for additional headers. `--transport sse` selects an SSE endpoint; HTTP and stdio are inferred from `--url` and `--command`. Alternatively, use `--server-config '<JSON object>'` for the full existing MCP server configuration contract. This form cannot be combined with the typed transport options.

Templates remain literal in the YAML file and resolve from the environment when connecting. Duplicate additions fail unless `--replace` is provided. Add and remove preserve unrelated YAML fields and comments. Operators are responsible for the selected executable, endpoint, credentials and permissions; direct tool calls execute the explicitly requested operation.

## Discover and call

```bash
dexto mcp list --json
dexto mcp connect local --json
dexto mcp tools local --json
dexto mcp call local upstream_tool_name --arguments '{"message":"hello"}' --json
dexto mcp resources local --json
dexto mcp prompts local --json
dexto mcp remove local --json
```

`list` reports configured names, transports, enabled state and configured/disabled status without connecting or displaying URLs, commands, environment values or headers. `connect` is a probe. Discovery and calls each open their own connection and close it before returning; successful output includes `connection: "closed"`.

`tools` includes advertised input schemas. `call` accepts the exact upstream tool name, validates its arguments using Core, and preserves the MCP tool result, including `isError` and its content. An MCP error result has a nonzero exit status. `resources` and `prompts` list metadata; reading resources and rendering prompts are outside this command slice.

With `--json`, stdout contains one JSON outcome. Exit status 0 means success, 2 means invalid usage/configuration or configuration I/O, 3 means connection failure, and 4 means operation, MCP tool-result or cleanup failure. Configuration and connection diagnostics omit raw credential-bearing details. Returned tool content is the requested server data. These commands do not provide interactive OAuth or elicitation.

## Expose the configuration as a gateway

```bash
dexto mcp --group-servers --config .dexto/mcp.yml
```

This runs the existing stdio aggregation server using the same MCP-only file, without agent configuration resolution. Once initialized, the gateway owns its upstream connections and closes them on downstream transport closure, stdin EOF, SIGINT or SIGTERM. Connection initialization does not install signal handlers. Without `--config`, the existing `--agent` configuration resolution remains available. See [grouping MCP servers](./dexto-group-mcp-servers.md) for client configuration.
