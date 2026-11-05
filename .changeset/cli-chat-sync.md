---
'dexto': minor
'@dexto/tui': patch
---

Chats in the interactive CLI sync to the signed-in person's Dexto Cloud account, redacted, with a first-run notice before anything syncs. `/sync` shows or changes sync (`/sync off`, `/sync off project`), `/private` keeps a chat on this machine and deletes its cloud copy, and `dexto chat delete` deletes the cloud copy too. Signing in asks for the `chats:sync` scope only while sync is on.
