---
'@dexto/agent-management': patch
'dexto': patch
---

Updated LLM fallback handling in subagent spawn tool. Spawn tool now checks for any LLM-errors and falls back to parent's active runtime config - accounts for model switching during session runtime.  

