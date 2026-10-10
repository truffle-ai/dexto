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

The default `text` format writes the final assistant response to stdout. Startup information, tool activity, and diagnostics go to stderr. Exit code `0` means a final response was produced without a fatal error; task failures exit with `1`.

## JSON results

```bash
dexto run "summarize this repository" --format json > result.json
```

JSON mode writes one result object:

```json
{
    "version": 1,
    "status": "completed",
    "sessionId": "example-session",
    "content": "Repository summary",
    "totalTokens": 42
}
```

`totalTokens` is present when usage is available. Failed results have `status: "failed"` and an `error` message. A failure before session creation omits `sessionId`. A fatal error after a response can include both `content` and `error`; check `status` and the process exit code before treating the result as successful.

## JSONL events

```bash
dexto run "summarize this repository" --format jsonl > events.jsonl
```

Each stdout line is a version-1 JSON object. Selected streaming events use these types:

| Type            | Fields                                                       |
| --------------- | ------------------------------------------------------------ |
| `message_delta` | `content`                                                    |
| `tool_call`     | `toolName`, `args`, optional `callId`                        |
| `tool_result`   | `toolName`, `success`, optional `callId` and failure `error` |
| `response`      | `content`                                                    |
| `warning`       | `errors`                                                     |
| `run_error`     | `recoverable`, `error`                                       |
| `approval_required` | `approvalId`, `approvalType`, `message`, optional `sessionId`; tool requests include `toolName` and `toolCallId`, command requests include `toolName` |

Exactly one terminal `complete` or `error` object follows normal task execution. It includes final `content` when available, optional `sessionId` and `totalTokens`, and an `error` message on failure. Use that terminal object as the task outcome: recoverable stream errors and failed tool calls can be followed by a successful completion.

```json
{"version":1,"type":"message_delta","content":"Repository "}
{"version":1,"type":"response","content":"Repository summary"}
{"version":1,"type":"complete","sessionId":"example-session","content":"Repository summary"}
```

Unsupported output formats fail during argument parsing before an agent starts. Process termination, broken output pipes, and argument-parser errors do not promise a terminal object.

## Permissions

Local TUI and headless tasks use the same configured Core permission policy. With no override, `permissions.mode` in the agent configuration applies; Core defaults to `auto-approve` when omitted. Select a mode for either interface with the global option:

```bash
dexto --permissions-mode manual
dexto --permissions-mode manual run "inspect this repository" --format json
dexto --permissions-mode auto-approve run "format this repository"
```

`--auto-approve` and `--bypass-permissions` are aliases for selecting `auto-approve`. Combining either alias with explicit `manual` is an error. These options do not bypass mandatory approvals or alter Core allow rules. The TUI footer shows configured approvals separately from temporary session shortcuts.

Headless tasks disable interactive elicitation and cannot collect approvals. When Core requires approval, the operation is denied immediately and the agent can recover and continue to task completion. Text reports `[APPROVAL_REQUIRED]` on stderr. JSON includes an `approvalRequired` array, and JSONL emits `approval_required` records plus the array in its terminal result. These records identify unavailable approval; a completed response does not mean the blocked action executed. Review the task in the TUI when approval is needed. No new task limit is imposed.
