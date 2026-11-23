## Why

ACP clients such as T3 Code and Zed drive coding agents over the Agent Client Protocol. Dexto has no ACP entry point, so people who use those clients cannot run the Dexto agent there without a wrapper that re-implements the agent loop.

## What Changes

- Add `dexto acp`, an ACP v1 agent on stdio that drives the same CLI agent loop `dexto run` uses.
- Map ACP sessions to Dexto sessions, prompts to `DextoAgent.stream`, streamed text, reasoning, tool calls and todo plans to `session/update`, Dexto approvals to `session/request_permission`, `session/cancel` to `DextoAgent.cancel`, and the session model to a `model` config option.
- Refuse a second prompt in a session while one runs.

Scope: the stdio server, sessions (new, load), prompts, permissions, cancel and model selection. Non-goals in this change: ACP diff content, elicitation, session listing, session modes, slash commands, usage updates, client-supplied MCP servers and ACP Registry listing; later changes add them.

## Capabilities

### New Capabilities

- `acp-server`: Serving the Dexto CLI agent to ACP clients over stdio.

### Modified Capabilities

None.

## Impact

New CLI command and a runtime dependency on `@agentclientprotocol/sdk`, plus a CLI minor changeset. Core, server, images and published `@dexto/*` contracts are unchanged. dexto-cloudflare does not consume the CLI command.
