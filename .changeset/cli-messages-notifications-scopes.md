---
'@dexto/agent-management': patch
---

`messages:read`, `messages:write`, `notifications:read` and `notifications:write` join `CLI_LOGIN_SCOPES`, so `dexto channels` and `dexto notifications` can ask a sign-in that lacks them to sign in again.
