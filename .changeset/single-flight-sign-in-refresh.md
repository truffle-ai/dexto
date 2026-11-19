---
'@dexto/agent-management': patch
'dexto': patch
---

Refresh a saved Dexto sign-in one at a time: concurrent requests in a process share one refresh, and other processes wait on a lock file beside the login and use the tokens it saved, so two refreshes of one rotating token no longer race (DEXTO-3437). Each refresh is bounded at 10 s whatever its caller, the lock names its holder and only the holder releases it, and a crashed process's lock is taken over atomically.
