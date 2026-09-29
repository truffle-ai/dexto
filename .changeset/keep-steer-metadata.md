---
'@dexto/core': patch
---

Keep a queued steer that carries its own metadata, such as a host event source, as a separate injected message with that metadata, instead of merging it into the user's steers.
