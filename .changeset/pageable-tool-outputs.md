---
'@dexto/core': minor
'@dexto/image-local': patch
---

Keep large tool outputs readable instead of cutting them. When a tool result is larger than min(25k tokens, 10% of the model's input window), or one step's results exceed 40% of the window, core stores the full text in the new `toolOutputs` store and keeps a head and tail preview in history that names the new core `tool_output_read` tool. The model reads stored or pruned results back by tool call id, by line range or pattern, within its own session. This replaces the 8,000-character cut of plain-string results and the 120,000-character cut of text parts. Pruned results now point to `tool_output_read` instead of suggesting a re-run.

Hosts that build their own `DextoStoreMap` must add a `toolOutputs: ToolOutputStore` (`DatabaseBackedToolOutputStore` works with any `Database`) and delete a session's outputs with the session.
