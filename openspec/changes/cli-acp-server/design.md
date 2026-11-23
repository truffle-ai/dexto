## Context

The CLI bootstraps one agent per process (`bootstrapAgentFromGlobalOpts`) and `dexto run` drives it with `DextoAgent.stream`. ACP clients launch an agent command once and open sessions on it, each with a working directory.

## Goals / Non-Goals

Reuse the CLI bootstrap and the core agent loop unchanged; keep stdout reserved for protocol messages. No core changes, no new agent loop, no transport other than stdio.

## Decisions

- One agent per process, started by the first `session/new` or `session/load` in that session's directory. Concurrent first sessions share the same start. Later sessions in another directory change the process directory and the agent workspace to the Dexto project root of that directory, as the bootstrap does.
- Each running prompt records the ACP connection context, its open tool calls and whether it was cancelled. Dexto approvals raised during the prompt become `session/request_permission` on that context; the tool call is reported before the permission request because Dexto raises approval before its tool-call event reaches the stream.
- A cancelled Dexto stream ends without a completion event, so the prompt answers `cancelled` from its own record. Tool calls left open end as `failed` (ACP v1 has no cancelled tool status).
- The model option lists the session's model plus the person's Dexto favorites and recents; choosing one calls `switchLLM` for that session and records it as recent, as the TUI picker does.
- `console.log` and `console.info` go to stderr; the headless bootstrap already uses a silent logger.

## Risks / Trade-offs

Changing the process directory makes concurrent sessions in different directories share one process directory; tools resolve paths against the workspace, which is set per change. A single process serves one client, so this stays acceptable until multi-root support is needed.

## Migration Plan

New command in a CLI minor release; remove it to roll back.
