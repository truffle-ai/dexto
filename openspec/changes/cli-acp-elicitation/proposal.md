## Why

Under `dexto acp`, the `ask_user` tool always fails: the CLI's non-interactive bootstrap turns elicitation off because nobody can answer, so core throws "Elicitation is disabled". ACP clients such as T3 Code can render forms through `elicitation/create`, so the person could answer there.

## What Changes

- `dexto acp` bootstraps in a new `acp` mode. It stays quiet like `headless-run`, but keeps elicitation on.
- A Dexto form request (`ask_user`, or an MCP server's elicitation) becomes an ACP `elicitation/create` form in the session, when the client advertises `elicitation.form`:
    - an accepted form returns its values to the tool;
    - a declined form denies the request;
    - a cancelled form, or a cancelled turn, cancels it. A cancelled turn withdraws the open form.
- Fallback: when the client shows no forms, or the form has a field ACP forms cannot show, the request is answered with a message telling the model to ask the person in its reply instead.

Part 3 of DEXTO-2849; it builds on `cli-acp-server`.

## Capabilities

### Modified Capabilities

- `acp-server`: questions from the agent are asked as ACP forms.

## Impact

- `packages/cli/src/cli/commands/acp`.
- The bootstrap mode type in `register-context.ts` and its use in `index-main.ts`.
- No core changes.
