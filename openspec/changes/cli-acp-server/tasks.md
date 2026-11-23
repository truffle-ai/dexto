## 1. ACP server

- [x] 1.1 Integration tests: a real `dexto acp` process against a scripted local model and an ACP client over stdio.
- [x] 1.2 Sessions, prompts, streamed text and tool calls, todo plans, permissions, cancel, load replay and the model option.
- [x] 1.3 Refuse a second prompt while one runs; share one agent start; workspace follows each session's directory; refuse a prompt in another directory while a turn runs.

## 2. Validation and release

- [x] 2.1 Focused tests, eslint and prettier on the changed files; upstream CI for build, typecheck and the full suite.
- [x] 2.2 CLI minor changeset.
- [ ] 2.3 Upstream PR through CI and review.
