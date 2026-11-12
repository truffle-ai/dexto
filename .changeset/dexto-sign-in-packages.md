---
'@dexto/agent-management': minor
'@dexto/cloud-client': minor
'@dexto/tui': minor
---

Support for dexto 2.0's sign-in:

- `@dexto/agent-management`: the Dexto sign-in store and OAuth client (`dextoAccounts`, `dextoSignIn`, `dextoCloud`), Dexto models on the sign-in (`dextoGateway`, used by `createModelAuthResolver` for `dexto-nova`), and the Dexto MCP for local sessions (`dextoMcp`). `isDextoAuthenticated` and `canUseDextoProvider` read the sign-in; `getDextoApiKeyFromAuth` is removed.
- `@dexto/cloud-client`: new, a typed client for Dexto's public `/v1` API.
- `@dexto/tui`: the host's sign-in services are `currentSignIn`, `signIn`, `signOut` and `dextoCreditBalance`, replacing 1.x's login internals.
