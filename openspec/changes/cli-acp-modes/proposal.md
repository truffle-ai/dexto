## Why

`dexto acp` always asks before approval-gated actions, has no plan mode, offers no slash commands and reports no context usage. The TUI has all four: Shift+Tab cycles Asks you, Plan, Accept edits and Full access; `/name` runs a prompt; and the footer shows context use. ACP clients (Zed, T3 Code) show session modes, a command menu and a usage meter when the agent sends them (DEXTO-2849, slice 5).

## What Changes

- Sessions offer four ACP modes: Asks you, Plan, Accept edits and Full access. A session starts in the agent's `permissions.mode`; `session/set_mode` switches it.
- Full access approves tool and command approvals; Accept edits approves file edits, writes and plan updates inside the session's workspace. A request marked `autoApproval: 'disallowed'` and every form still ask in every mode, as in the TUI.
- Plan adds plan mode's instructions to the first prompt sent in it, and an approved plan review moves the session back to Asks you with `current_mode_update`.
- Sessions announce the agent's user-invocable prompts with `available_commands_update`; a prompt starting `/name` runs that prompt with `key=value` arguments and context, as in the TUI.
- Each turn ends with a `usage_update`: context tokens used, the context window, and the session's estimated cost when known.
- `@dexto/tui` exports these rules as `@dexto/tui/host-rules`, and the TUI uses the same functions, so both hosts agree.

## Capabilities

### Modified Capabilities

- `acp-server`: session modes, slash commands and usage updates.

## Impact

- `packages/tui/src/host-rules.ts` (new, pure) and the TUI code that now imports it; behavior unchanged.
- `packages/cli/src/cli/commands/acp/acp-agent.ts`, `acp-modes.ts`. No core changes.
