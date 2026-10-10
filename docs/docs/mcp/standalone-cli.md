---
sidebar_label: Standalone MCP CLI
sidebar_position: 9
---

# Standalone MCP CLI

Use `dexto mcp` to configure, discover and call MCP servers without an agent, model credentials or Dexto login. Commands use `.dexto/mcp.yml` in the current directory by default. Supply `--config <path>` before or after the subcommand to select another MCP-only YAML file. An explicit subcommand option overrides the parent option.

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

Templates remain literal in the YAML file and resolve from the environment when connecting. Duplicate additions fail unless `--replace` is provided. Add and remove preserve unrelated YAML fields and comments. See [local configuration edits](#local-configuration-edits) for replacement, permissions and concurrency limits. Operators are responsible for the selected executable, endpoint, credentials and permissions; direct tool calls execute the explicitly requested operation.

## Local configuration edits

On POSIX, add/remove write a unique private temporary file beside the selected configuration and rename it into place after writing. Every successful POSIX edit produces mode `0600`, including when an existing file was `0644`. Replacement changes the file inode; it does not retain shared-file modes or hard-link relationships.

On Windows, edits retain the existing in-place write behavior and existing file ACLs. New files use the filesystem's default ACLs; mode `0600` does not establish an owner-only Windows ACL. Windows writes are not atomic: a failed in-place write can leave a partially written file, as before.

Observed existing or dangling leaf symlinks are rejected for edits with `config_write_failed` and exit status 2. Select the actual regular configuration file instead. Read-only commands retain their existing path handling. On POSIX, a failed temporary write or rename leaves the original file unchanged; temporary cleanup is best-effort and failures omit raw filesystem details.

Keep the selected parent directory under your control and serialize edits. These commands do not protect against parent-directory symlink traversal or concurrent mutations, do not coordinate overlapping whole-YAML edits, and do not promise crash durability. Credential templates and unrelated YAML comments/fields remain literal and preserved.

## Discover and call

```bash
dexto mcp list --json
dexto mcp connect local --json
dexto mcp tools local --json
dexto mcp call local upstream_tool_name --arguments '{"message":"hello"}' --json
dexto mcp resources local --json
dexto mcp read-resource local fixture://resource --json
dexto mcp prompts local --json
dexto mcp get-prompt local upstream_prompt_name --arguments '{"name":"Ada"}' --json
dexto mcp remove local --json
```

`list` reports configured names, transports, enabled state and configured/disabled status without connecting or displaying URLs, commands, environment values or headers. `connect` is a probe. Discovery and calls each open their own connection and close it before returning; successful output includes `connection: "closed"`.

`tools` includes advertised input schemas. `call` accepts the exact upstream tool name, validates its arguments using Core, and preserves the MCP tool result, including `isError` and its content. An MCP error result has a nonzero exit status. `resources` and `prompts` list metadata. `read-resource` accepts the exact upstream resource URI and returns its complete result, including text or binary content. `get-prompt` accepts the exact upstream prompt name and returns its complete rendered result. Prompt arguments must be a JSON object of string values; invalid arguments return exit status 2 before connecting. Both commands use the same configuration selection, connection cleanup and error outcomes as direct tool calls.

After command parsing succeeds, `--json` makes stdout contain one JSON outcome. Exit status 0 means success, 2 means invalid command data/configuration or configuration I/O, 3 means connection failure, and 4 means operation, MCP tool-result or cleanup failure. Parser errors such as an unknown option or missing operand use the standard CLI error on stderr and exit status 1, before an action runs. Configuration and connection diagnostics omit raw credential-bearing details. Returned MCP content is the requested server data. These commands do not provide interactive OAuth or elicitation.

## Expose the configuration as a gateway

```bash
dexto mcp --group-servers --config .dexto/mcp.yml
```

This runs the existing stdio aggregation server using the same MCP-only file, without agent configuration resolution. Once initialized, the gateway owns its upstream connections and closes them on downstream transport closure, stdin EOF, SIGINT or SIGTERM. Connection initialization does not install signal handlers. Without `--config`, the existing `--agent` configuration resolution remains available. See [grouping MCP servers](./dexto-group-mcp-servers.md) for client configuration.
