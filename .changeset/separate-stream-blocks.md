---
'@dexto/core': patch
---

Separate blocks of text, and blocks of reasoning, that a model sends in one step. The stream processor appended every delta to one string, so two text blocks read "…as ready.Implementation is underway…" and two reasoning titles read "**First\*\***Second\*\*". A delta that opens a new stream block (a different block id) now starts a new paragraph. The same separator goes into the stored assistant message, the returned text and reasoning, and the `llm:chunk` events, so a client that concatenates chunks ends with exactly the stored text. Streams that give no block ids, single-block responses and empty blocks are unchanged.
