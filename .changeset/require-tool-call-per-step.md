---
'@dexto/core': patch
---

`LLMExecutionControl.requiresToolCall` replaces `toolChoice: 'required'` (added in 1.19.7). Core asks the host before each model step that has tools whether that step must call one. A host can then stop forcing once the turn is answered, for example when input steered in after a turn-ending tool continues the turn and needs no answer.
