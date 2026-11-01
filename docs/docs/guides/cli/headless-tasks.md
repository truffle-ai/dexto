---
sidebar_position: 4
title: 'Headless Tasks'
---

# Headless Tasks

Use `dexto run` for a single task without opening the TUI. Pass a prompt argument or pipe the prompt through stdin.

```bash
dexto run "summarize this repository"
echo "summarize this repository" | dexto run
```

At a terminal, `dexto run` prints the final reply. When stdout isn't a terminal (a pipe, a file, or an agent reading it), it prints one JSON result instead. `--text`, `--json` and `--stream-json` choose explicitly; pass only one. Startup information, tool activity and diagnostics always go to stderr, and nothing decorative reaches stdout.

Exit codes are the same for every `dexto` command: `0` done, `1` failed, `2` usage (such as an empty prompt), `3` needs sign-in or permission, `4` needs confirmation, `5` not found, `6` waiting on a person.

## JSON result

```bash
dexto run "summarize this repository" --json > result.json
```

`--json` writes one result object:

```json
{
    "type": "result",
    "status": "completed",
    "session_id": "example-session",
    "content": "Repository summary",
    "total_tokens": 42,
    "permission_denials": []
}
```

`total_tokens` is present when usage is available. A failed result has `status: "failed"` and `error: { "code", "message" }`, where `code` is `usage` or `failed`; the same `{"error": …}` also goes to stderr. A failure before the session starts has no `session_id`. A fatal error after a reply can carry both `content` and `error`, so check `status` and the exit code before treating the result as a success.

## Streaming events

```bash
dexto run "summarize this repository" --stream-json > events.jsonl
```

`--stream-json` writes one JSON object per line as the run goes:

| Type                | Fields                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `message_delta`     | `content`                                                                                                             |
| `message_reset`     | `reason`: drop the deltas since the last response                                                                     |
| `tool_call`         | `tool_name`, `args`, optional `call_id`                                                                               |
| `tool_result`       | `tool_name`, `success`, optional `call_id` and failure `error`                                                        |
| `response`          | `content`                                                                                                             |
| `warning`           | `errors`                                                                                                              |
| `run_error`         | `recoverable`, `error`                                                                                                |
| `approval_required` | `approval_id`, `approval_type`, `message`, optional `session_id`; tool requests add `tool_name` and `tool_call_id`    |

It ends with exactly one `result` object, the same as `--json` writes. Use it as the run's outcome: recoverable errors and failed tool calls can come before a successful result.

```json
{"type":"message_delta","content":"Repository "}
{"type":"response","content":"Repository summary"}
{"type":"result","status":"completed","session_id":"example-session","content":"Repository summary","permission_denials":[]}
```

A process killed mid-run, a broken output pipe or an argument-parser error doesn't promise a `result`.

## Permissions

Local TUI and headless tasks use the same configured Core permission policy. With no override, `permissions.mode` in the agent configuration applies; Core defaults to `auto-approve` when omitted. Select a mode for either interface with the global option:

```bash
dexto --permissions-mode manual
dexto --permissions-mode manual run "inspect this repository" --json
dexto --permissions-mode auto-approve run "format this repository"
```

`--auto-approve` and `--bypass-permissions` are aliases for selecting `auto-approve`. Combining either alias with explicit `manual` is an error. These options do not bypass mandatory approvals or alter Core allow rules. The TUI footer shows configured approvals separately from temporary session shortcuts.

Headless tasks disable interactive elicitation and cannot collect approvals. When Core requires approval, the operation is denied immediately and the agent can recover and continue to task completion. Text reports `[APPROVAL_REQUIRED]` on stderr. The result lists each refused approval in `permission_denials`, and `--stream-json` also emits an `approval_required` event for each. These records identify unavailable approval; a completed response does not mean the blocked action executed. Review the task in the TUI when approval is needed. No new task limit is imposed.
