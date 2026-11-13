---
'@dexto/core': patch
---

Keep a chat working after a provider rejects a request that carries media. A 400 on a request with images or files is retried once with that media as text placeholders; when the retry succeeds, the media is marked withheld so later turns stop resending it.
