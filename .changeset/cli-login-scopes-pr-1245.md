---
'@dexto/agent-management': patch
---

`autobots:read`, `autobots:write`, `skills:write` join `CLI_LOGIN_SCOPES`, so `dexto autobots` can ask a sign-in that lacks them to sign in again.
