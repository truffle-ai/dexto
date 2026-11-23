---
'@dexto/agent-management': patch
---

`applications:read` joins `CLI_LOGIN_SCOPES`, so `dexto applications` can ask a sign-in that lacks it to sign in again.
