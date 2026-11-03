---
'@dexto/core': patch
---

Preserve paired tool results in imported transcripts whose parts interleave with other messages. Mark every message in the imported region with `IMPORTED_TRANSCRIPT_METADATA_KEY` so normal turns remain outside that region.
