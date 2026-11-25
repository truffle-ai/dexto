---
'dexto': patch
'@dexto/agent-management': patch
---

A saved `dexto login` sign-in now comes before `DEXTO_API_KEY`. Every command, Dexto models and the Dexto MCP pick a credential in one order: `--api-key`, then the profile's sign-in, then `DEXTO_API_KEY`, then a saved API key. A key left in the environment (for example in dexto 1.x's `~/.dexto/.env`) no longer overrides the sign-in. `dexto whoami` names the source, and `--json` reports it as `source`: `flag`, `sign_in`, `environment` or `saved_key` (a saved API key was `login` before).
