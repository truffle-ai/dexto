---
'dexto': patch
---

`dexto chat browser-profiles` works again. It failed for everyone with "Dexto didn't return a valid browser profile list" because it still required a per-profile `available` flag the server no longer sends (one profile can now serve several chats). It now lists each profile's id and name.
