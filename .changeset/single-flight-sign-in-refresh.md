---
'@dexto/agent-management': patch
---

Refresh a saved Dexto sign-in one at a time: concurrent requests in a process share one refresh, and other processes wait on a lock file beside the login and use the tokens it saved, so two refreshes of one rotating token no longer race (DEXTO-3437).
