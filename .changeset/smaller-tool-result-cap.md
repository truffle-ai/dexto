---
'@dexto/core': patch
---

Keep less of one tool result in the conversation: about 24,000 characters instead of 100,000. A result stays in the history for every later step, so a large one was sent to the model again on each step. Above the cap the model still sees the head and the tail with a marker naming `tool_output_read`, and the full output stays stored for it to page through or search. Smaller context windows keep their existing limit of 10% of the window.
