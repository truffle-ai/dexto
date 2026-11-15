# @dexto/cloud-client

## 1.18.1

## 1.18.0

### Minor Changes

- 9a75f3a: A signed-in person's Dexto Skills library joins local skill discovery:
    - `dexto`: each session syncs the library into `~/.dexto/cloud-skills` (only Skills whose files changed download; Skills that left the library are removed; offline keeps the last copy with one warning; with no person signed in the copy is removed). `dexto skills sync` syncs on demand. `--api-key -` reads the key from stdin, and `--api-key` with no value asks for it. The coding agent ships an `import-chats` skill for `dexto chat local` and `dexto chat import`.
    - `@dexto/agent-management`: `~/.dexto/cloud-skills` is the last standalone skill root, with source `cloud`, so a local Skill of the same name wins. `getStandaloneSkillPaths` is exported.
    - `@dexto/cloud-client`: `GET /v1/skills` and `GET /v1/skills/{skill_id}/bundle`.

- 9a75f3a: Support for dexto 2.0's sign-in:
    - `@dexto/agent-management`: the Dexto sign-in store and OAuth client (`dextoAccounts`, `dextoSignIn`, `dextoCloud`), Dexto models on the sign-in (`dextoGateway`, used by `createModelAuthResolver` for `dexto-nova`), and the Dexto MCP for local sessions (`dextoMcp`). `isDextoAuthenticated` and `canUseDextoProvider` read the sign-in; `getDextoApiKeyFromAuth` is removed.
    - `@dexto/cloud-client`: new, a typed client for Dexto's public `/v1` API.
    - `@dexto/tui`: the host's sign-in services are `currentSignIn`, `signIn`, `signOut` and `dextoCreditBalance`, replacing 1.x's login internals.

### Patch Changes

- 9a75f3a: `dexto trace list`, `dexto trace view <run_id>` and `dexto span list <run_id>` are back, on Dexto's public `/v1/traces` API: 1.x's filters (`--period`, `--status`, `--session`, `--name`, `--sort`, `--limit`) under the 2.0 output contract (tables at a terminal, JSON with `--json` or when piped). `dexto trace <run_id>` is now `dexto trace view <run_id>`, and the JSON is the `/v1/traces` objects rather than 1.x's `{ traces }`, `{ trace }` and `{ spans }`. The client covers the run trace operations.
- 9a75f3a: The client covers Dexto's synced chat operations (`/v1/synced_chats`, its moves and messages) from the current `/v1` OpenAPI document, and a `CloudApiError` carries `retryAfterSeconds` from the response's `Retry-After` header.
- 9a75f3a: Three string clean-ups no longer slow down badly on long runs of the same character: trimming trailing slashes from the Cloud API base URL, redacting credentials in a resource URI that is not a valid URL, and joining a multi-line tool argument onto one row.
