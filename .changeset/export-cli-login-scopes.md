---
'@dexto/agent-management': patch
'dexto': patch
---

Export `dextoSignIn.CLI_LOGIN_SCOPES`, every scope the CLI asks a sign-in for by name, so Dexto Cloud can test that its sign-in accepts each one. The CLI's own scope checks now only accept scopes from that list.
