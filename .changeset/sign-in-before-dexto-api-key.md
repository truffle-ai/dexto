---
'dexto': minor
'@dexto/agent-management': minor
---

A saved `dexto login` sign-in now comes before `DEXTO_API_KEY`. Every command, Dexto models and the Dexto MCP pick a credential in one order: `--api-key`, then the profile's sign-in, then `DEXTO_API_KEY`, then a saved API key. A key left in the environment (for example in dexto 1.x's `~/.dexto/.env`) no longer overrides the sign-in.

- A sign-in that can no longer refresh (revoked or expired) now fails the command instead of falling back to `DEXTO_API_KEY`. Run `dexto logout` to use the key, or pass it with `--api-key`.
- With only `DEXTO_API_KEY` set, Dexto models go through the same gateway path as a sign-in, to `DEXTO_PUBLIC_API_URL` (default `https://api.dexto.ai/v1`). `DEXTO_API_URL` and the agent config's `llm.baseURL` and `llm.apiKey` are ignored for `dexto-nova`.
- `dexto whoami` names the source. In `--json`, `source` is `flag`, `sign_in`, `environment` or `saved_key`; a saved API key was `login` before, and the signed-in result now has `source` too. In text, a saved key reads `(saved key, profile <name>)`, and a sign-in starts with a `source  sign-in` row.
- `CredentialSource` in `@dexto/agent-management` drops `login` for `sign_in` and `saved_key`; `chooseCredential` is new.
