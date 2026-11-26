---
'dexto': minor
'@dexto/agent-management': minor
---

Add `dexto applications create`, `deploy`, `rollback`, `release delete`, `suspend`, `resume`, `retire`, `purge` and `install` to manage a Dockerfile Application from the CLI. Each one asks first (or takes `--yes`), offers `--dry-run`, and needs the new `applications:write` sign-in scope; `purge` also takes `--confirm-application-id`.
