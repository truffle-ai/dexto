---
'@dexto/core': patch
'@dexto/llm': patch
---

Send Claude's signed thinking blocks back with tool results on `dexto-nova` and `openrouter`, so tool loops keep the tool-calling turn's thinking (including signature-only and redacted blocks)
