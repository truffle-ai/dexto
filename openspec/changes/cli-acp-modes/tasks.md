## 1. Shared rules

- [x] 1.1 Add `@dexto/tui/host-rules` with `autoApproves`, slash-command parsing, plan-mode wrapping and `planApproved`, with unit tests.
- [x] 1.2 Use them in the TUI with no behavior change; its existing tests pass.

## 2. Modes

- [x] 2.1 Offer the four modes on new, loaded and resumed sessions, starting from `permissions.mode`; handle `session/set_mode`.
- [x] 2.2 Approve in Full access and Accept edits through `autoApproves`, with the session's workspace.
- [x] 2.3 Plan: send plan mode's instructions once, and leave Plan on an approved plan review.
- [x] 2.4 Integration tests: a disallowed tool still asks in Full access; Full access runs an approval-gated tool without asking; Accept edits uses the session's workspace; Plan injects and exits.

## 3. Commands and usage

- [x] 3.1 Announce user-invocable prompts with `available_commands_update` and run `/name` prompts.
- [x] 3.2 Send `usage_update` after each turn.
- [x] 3.3 Integration tests for both.
