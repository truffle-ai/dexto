---
'@dexto/agent-management': patch
---

`apps:write`, `marketplace:read`, `marketplace:write`, `skills:read`, `skills:write` join `CLI_LOGIN_SCOPES`, so `dexto marketplace` can ask a sign-in that lacks them to sign in again.
