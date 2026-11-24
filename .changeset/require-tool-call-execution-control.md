---
'@dexto/core': patch
---

`LLMExecutionControl.toolChoice: 'required'` makes every model step that has tools call one, for hosts where plain text is never shown and a tool ends the turn. Claude steps that think leave the choice to the model, since Anthropic rejects a forced tool choice with thinking on; hosts keep `beforeTurnEnd` as the fallback.
