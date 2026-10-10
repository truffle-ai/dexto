# Proposal

## Why

Standalone MCP discovery already exposes resources and prompts, but users and automation cannot yet read those resources or render the prompts through the CLI. Complete that direct-operation workflow using the existing owned MCP runtime.

## What Changes

- Add `mcp read-resource <server> <uri>` and `mcp get-prompt <server> <prompt> --arguments <JSON>`.
- Preserve complete MCP results and exact upstream identities, with string-valued prompt argument validation before connection.
- Reuse configuration selection, safe errors, JSON output and connection cleanup.

## Capabilities

### New Capabilities

- `standalone-mcp-cli`: Direct resource reads and prompt rendering under the local caller's authority.

### Modified Capabilities

None; the repository has no durable specs yet.

## Impact

CLI registration/runtime, real-process tests, public usage documentation and a CLI patch changeset. No Core API, dependency, agent bootstrap, permission policy, hosted API or Cloud implementation changes. Interactive MCP authentication and network host expansion are non-goals.
