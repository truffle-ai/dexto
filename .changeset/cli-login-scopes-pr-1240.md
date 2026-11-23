---
'@dexto/agent-management': patch
---

`contacts:read`, `contacts:write` join `CLI_LOGIN_SCOPES`, so `dexto workspace contacts` can ask a sign-in that lacks them to sign in again.
