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

## Concurrent configuration edits

`add` and `remove` acquire the selected configuration's sibling `.lock` file before reading YAML and release it after editing. A competing CLI edit returns exit 2 with `config_busy` and leaves configuration and the existing lock unchanged. Retry after the other edit finishes; read-only commands remain available.

If lock cleanup fails after an edit commits, the command returns exit 2 with `config_lock_cleanup_failed`. The edit may already have committed: inspect the configuration before retrying or removing its lock. If the edit itself already failed, its original error is preserved even if lock cleanup also fails.

Abrupt termination can leave a sidecar such as `.dexto/mcp.yml.lock`. No PID or age-based automatic recovery occurs. Only remove that sidecar manually after confirming no CLI edit is active, then inspect the configuration before retrying. The lock coordinates cooperating CLI writers using the selected configuration pathname and its sibling lock; it does not track inode aliases. External editors do not participate, and existing platform-specific read/write semantics remain unchanged.

## Interrupt a one-shot command

When the process receives SIGINT or SIGTERM during a connecting command, it cancels active tool, resource or prompt requests and closes its owned connection before returning. With `--json`, stdout contains one safe outcome:

```json
{
    "server": "local",
    "signal": "SIGTERM",
    "error": { "code": "mcp_interrupted", "message": "MCP operation interrupted." }
}
```

SIGINT exits 130; SIGTERM exits 143. The first received signal wins, including when repeated signals arrive during cleanup. Normal completion and operation errors keep their existing outcomes.

If interrupted during startup, the command waits for the existing handshake/discovery to settle and skips the requested operation afterward. Those startup requests currently use the SDK's default request deadline (60 seconds per pending request), independently of the configured operation timeout, so interruption during startup may take longer to return. Cancellation is advisory and does not roll back server side effects, including operations completed before a signal arrives during cleanup. SIGKILL, OS termination, unresponsive cleanup, and platform termination that does not deliver a catchable signal do not guarantee graceful cleanup.

## Expose the configuration as a gateway

```bash
dexto mcp --group-servers --config .dexto/mcp.yml
```

This runs the stdio aggregation server using the same MCP-only file, without agent configuration resolution. Once initialized, the gateway owns its upstream connections and closes them on downstream transport closure, stdin EOF, SIGINT or SIGTERM. Connection initialization does not install signal handlers. Without `--config`, the existing `--agent` configuration resolution remains available. See [grouping MCP servers](./dexto-group-mcp-servers.md) for client configuration.

## Host a gateway over HTTP

Start the same aggregation library with an HTTP listener for local clients:

```bash
dexto mcp --group-servers --config .dexto/mcp.yml --transport http --port 3001
```

The default address is `http://127.0.0.1:3001/mcp`. Literal loopback addresses (`127.0.0.1` and `::1`) are open by default. If `DEXTO_SERVER_API_KEY` is supplied, every request requires `Authorization: Bearer <your-private-key>`. The gateway does not print the key. For authenticated access, provide a strong key through your environment or secret manager and use environment-based header templates in the client:

```bash
export DEXTO_SERVER_API_KEY='<your-private-key>'
# Start the gateway with this environment to enable bearer authentication.
dexto mcp add sandbox --url http://127.0.0.1:3001/mcp \
  --header 'Authorization=Bearer ${DEXTO_SERVER_API_KEY}' --config ./client-mcp.yml
dexto mcp tools sandbox --config ./client-mcp.yml --json
dexto mcp call sandbox tool_name --arguments '{}' --config ./client-mcp.yml --json
```

`--host 0.0.0.0` exposes the listener on other interfaces and requires a nonempty `DEXTO_SERVER_API_KEY` before connecting upstreams. Other hostnames, including `localhost`, use this same requirement. Use `--no-auth` only when you intentionally delegate authentication to your ingress or otherwise trust everyone who can reach the listener. This explicit option also overrides an environment key. For an outside client, use your sandbox's HTTPS ingress or a trusted private tunnel and its reachable URL. The built-in listener uses HTTP; it does not provision TLS, a public address or an account connection.

HTTP mode uses stateless Streamable HTTP at `/mcp`. It supports independent callers without persistent MCP sessions or a GET notification stream. Cancellation notifications sent as separate requests cannot target earlier requests. GET and DELETE requests return 405 after any configured authentication check. Loopback hosting checks the exact listener Host and Origin; clients should use the advertised loopback URL rather than an alternate hostname. Requests from other browser origins are rejected. Tools, resources and prompts retain the same startup snapshot and MCP results as stdio mode. Restart to rediscover changes. Interactive OAuth and elicitation are not supplied by the gateway.

The host owns one shared set of upstream connections. Completing or disconnecting one HTTP request releases that request's transport and propagates cancellation for its work, while other clients keep using the upstream servers. Stop the foreground host with SIGINT or SIGTERM to release its listener and owned subprocesses. Failed startup also releases acquired resources. Cancellation is advisory and does not undo completed effects.

An open listener or a valid gateway bearer key grants access to the configured catalog. Choose the upstream servers and trusted callers accordingly. Direct MCP forwarding does not run an agent approval policy or create an OS sandbox. Model credentials and Cloud login are unnecessary.
