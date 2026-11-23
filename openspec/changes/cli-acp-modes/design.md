## Decisions

- **Shared rules in `@dexto/tui`:** the CLI already depends on `@dexto/tui`, so the pure rules (auto-approval, slash-command parsing, plan-mode wrapping and plan-exit) move to `@dexto/tui/host-rules`, which has no UI imports. The TUI calls the same functions; its existing tests guard that its behavior is unchanged. No new package and no core change.
- **One auto-approval function:** `autoApproves(request, mode)` returns false first for `autoApproval: 'disallowed'`, so no mode can approve what the TUI would ask about. Full access approves tool and command approvals only; forms always ask.
- **Workspace for Accept edits:** the real path of the session's workspace root, not the process directory, because one `dexto acp` process serves sessions in several directories.
- **Mode per open session:** the mode lives with the open session in the ACP process. Plan remembers whether its instructions were sent, so they go once per entry into Plan, as in the TUI. Resume and load start in the configured `permissions.mode`.
- **Slash commands:** the command list is the agent's prompts with `userInvocable !== false`, keyed by command name. An unknown `/word` is sent as an ordinary message, because an ACP client may send text that starts with a slash (a path, for instance). A prompt that resolves to nothing is an invalid-params error.
- **Usage:** `used` is the context's actual tokens when the provider reported them, else Dexto's estimate; `size` is the model's context window; `cost` is the session's estimated cost in USD when known.
