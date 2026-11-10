---
'dexto': minor
---

Add `dexto workspace computers keys list|create|revoke` to manage computer enrollment keys from the terminal, so a script or agent can enroll machines it provisions (cloud VMs, CI runners) as connected computers without a browser. `create` prints the key once, with the `dexto-daemon connect` command to run on the machine.
