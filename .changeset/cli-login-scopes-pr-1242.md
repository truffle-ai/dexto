---
'@dexto/agent-management': patch
---

`network:read`, `network:write` join `CLI_LOGIN_SCOPES`, so `dexto workspace network` can ask a sign-in that lacks them to sign in again.
