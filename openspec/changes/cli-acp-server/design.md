## Context

The CLI bootstraps one agent per process (`bootstrapAgentFromGlobalOpts`) and `dexto run` drives it with `DextoAgent.stream`. ACP clients launch an agent command once and open sessions on it, each with a working directory.

## Goals / Non-Goals

Reuse the CLI bootstrap and the core agent loop unchanged; keep stdout reserved for protocol messages. No core changes, no new agent loop, no transport other than stdio.

## Decisions

- One agent per process, started by the first `session/new` or `session/load` in that session's directory. Concurrent first sessions share the same start. Each session remembers its directory; a prompt moves the process directory and the agent workspace to that directory's Dexto project root (as the bootstrap does) when the workspace points elsewhere.
- Each running prompt records the ACP connection context, its open tool calls and whether it was cancelled. Dexto approvals raised during the prompt become `session/request_permission` on that context; the tool call is reported before the permission request because Dexto raises approval before its tool-call event reaches the stream.
- A cancel that arrives before the Dexto run starts is applied again once the stream is open, since the first cancel found nothing to stop.
- A cancelled Dexto stream ends without a completion event, so the prompt answers `cancelled` from its own record. Tool calls left open end as `failed` (ACP v1 has no cancelled tool status).
- The model option lists the session's model plus the person's Dexto favorites and recents; choosing one calls `switchLLM` for that session and records it as recent, as the TUI picker does.
- The client's `mcpServers` in `session/new` and `session/load` are ignored; the agent uses the MCP servers in its own config.
- `console.log` and `console.info` go to stderr; the headless bootstrap already uses a silent logger.

## Risks / Trade-offs

The agent workspace is process-wide, so prompts in sessions with different directories cannot run at the same time: such a prompt is refused while another directory's turn runs. Clients usually open one directory per agent process, so this stays acceptable until multi-root support is needed.

## Migration Plan

New command in a CLI minor release; remove it to roll back.
