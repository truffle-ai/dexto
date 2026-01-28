---
"dexto": patch
"@dexto/core": patch
---

- Fix resource path display in CLI by stripping URI prefixes before relative path calculation.
- Improve resource discoverability by excluding non-project directories (`node_modules`, `.git`, `.turbo`, etc.) from filesystem scanning.
