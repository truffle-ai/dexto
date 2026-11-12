---
'dexto': minor
'@dexto/tui': patch
---

Chats in the interactive CLI can sync to the signed-in person's Dexto Cloud account, redacted. Sync is off until you turn it on with `/sync on`, which says what syncs before anything does. `/sync` shows or changes sync (`/sync off`, `/sync on project`, `/sync off project`), `/private` keeps a chat on this machine and deletes its cloud copy, and `dexto chat delete` deletes the cloud copy too. Signing in asks for the `chats:sync` scope only while sync is on. A 2.0 beta's saved default of sync on now reads as off; run `/sync on` to keep syncing.
