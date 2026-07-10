---
'@dexto/core': patch
---

Load only the selected model provider SDK when creating a language model. Model and LLM service
factories now resolve asynchronously so provider modules can be imported on demand.
