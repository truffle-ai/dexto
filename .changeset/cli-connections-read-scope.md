---
'dexto': patch
'@dexto/agent-management': patch
---

`dexto connections list` and `dexto connections status` now ask a sign-in without `connections:read` to sign in again, instead of listing only the model sign-ins and hiding the person's connectors (DEXTO-2923). `connections:read` joins `CLI_LOGIN_SCOPES`.
