---
'@dexto/core': patch
---

Tool schemas sent to the model are shorter: the `__meta.callActivity` schema on every tool keeps its fields and limits but carries two short examples instead of three long descriptions (765 to 341 characters), and uuid fields are described by `format: "uuid"` alone, without zod's long uuid pattern. Hosts that want detailed call-activity guidance give it once in their system prompt.
