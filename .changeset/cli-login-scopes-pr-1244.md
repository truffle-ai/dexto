---
'@dexto/agent-management': patch
---

`skills:read`, `skills:write` join `CLI_LOGIN_SCOPES`, so `dexto skills` can ask a sign-in that lacks them to sign in again.
