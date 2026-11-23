---
'dexto': minor
'@dexto/agent-management': patch
'@dexto/core': patch
---

`dexto acp` offers the Dexto account's models and reasoning effort, explains a model that needs a key or sign-in, and starts on the saved model even with `--agent`. Installed agents that still enable `invoke_skill` load with `skill_load`. A model switch to another provider no longer keeps the previous provider's `baseURL`.
