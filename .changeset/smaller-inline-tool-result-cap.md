---
'@dexto/core': patch
---

Keep less of one tool result in the conversation: about 16,000 characters (4,000 tokens) instead of about 24,000. A result stays in the history for every later step, and a host that loads the whole history for each step pays for every character of it in memory. Above the cap the model still sees the head and the tail with a marker naming `tool_output_read`, and the full output stays stored. Smaller context windows keep their existing limit of 10% of the window. One `tool_output_read` call now returns about 16,000 characters too, the same size as the cap, down from about 24,000.
