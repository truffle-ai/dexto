## Context

The CLI bootstraps one agent per process (`bootstrapAgentFromGlobalOpts`) and `dexto run` drives it with `DextoAgent.stream`. ACP clients launch an agent command once and open sessions on it, each with a working directory.

## Goals / Non-Goals

Reuse the CLI bootstrap and the core agent loop unchanged; keep stdout reserved for protocol messages. No core changes, no new agent loop, no transport other than stdio.

## Decisions

- One agent per process, started by the first `session/new` or `session/load` in that session's directory. Concurrent first sessions share the same start. The bootstrap sets the agent up for that directory's Dexto project root: its AGENTS.md or CLAUDE.md, prompts, Claude Code plugins and their MCP servers, and its storage paths. So a process serves one project: `session/new` and `session/load` in a directory with another project root are refused, and the client starts another `dexto acp` for it. Tool locations resolve against that root. A failed agent start is not cached, so the next session retries it.
- Each running prompt records the ACP connection context, its open tool calls and its abort controller. Dexto approvals raised during the prompt become `session/request_permission` on that context; the tool call is reported before the permission request because Dexto raises approval before its tool-call event reaches the stream.
- Each running prompt passes an abort signal to the Dexto run, so `session/cancel` stops it even before the run has started. The prompt keeps reading events until the run has ended, so the session is free again when the prompt answers `cancelled`.
- A cancelled run's stream ends without a stop reason the client needs, so the prompt answers `cancelled` from its abort signal. Tool calls left open end as `failed` (ACP v1 has no cancelled tool status), also when the run fails. A sub-agent's approval asks permission without opening a tool call, because the sub-agent's result never reaches this stream.
- The model option lists the session's model plus the person's Dexto favorites and recents; choosing one calls `switchLLM` for that session and records it as recent, as the TUI picker does.
- The client's `mcpServers` in `session/new` and `session/load` are ignored; the agent uses the MCP servers in its own config.
- `console.log` and `console.info` go to stderr; the headless bootstrap already uses a silent logger.

## Risks / Trade-offs

One project per process means a client that opens a second project needs a second process. Re-running the project setup on a live agent would need core support; clients usually open one project per agent process, so this stays acceptable until multi-root support is needed.

## Migration Plan

New command in a CLI minor release; remove it to roll back.
