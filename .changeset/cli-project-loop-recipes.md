---
'dexto': patch
'@dexto/agent-management': patch
---

`dexto projects recipes` lists the Loop recipes a Project can install, and `dexto projects install-recipe <project> <recipe>` installs one, or resumes it when paused, after asking (or with `--yes`). It schedules future runs only; `--timezone` defaults to this computer's (DEXTO-3483). `automations:read` and `automations:write` join `CLI_LOGIN_SCOPES`.
