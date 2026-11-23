---
'@dexto/agent-management': patch
---

`autobots:read` and `autobots:write` join `CLI_LOGIN_SCOPES`, so `dexto autobots` can ask a sign-in that lacks them to sign in again.
