---
'@dexto/core': patch
---

Let a tool end the turn, and let hosts continue a turn once before it ends. A tool can set `endsTurn` (a boolean, or a function of its parsed input). After a successful call, core records the result and stops with finish reason `tool-ended` instead of asking the model for another step, unless a steered user message arrived during that step. `LLMExecutionControl.beforeTurnEnd` runs when the model ends a turn on its own. The host can return `continue` with a message to run one more step, for example to remind the model to deliver its answer through a reply tool.
