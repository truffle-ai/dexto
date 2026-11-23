## Why

Under `dexto acp`, the model picker offers only the session's model and the person's favorites and recents. The models their Dexto account serves (DeepSeek, for instance) are missing, there is no reasoning effort to pick, and a model without its key fails with an internal error. The process also ignores the person's saved model, so `dexto --agent <path> acp` starts on the config's model rather than the one they chose. An agent installed by an older release that still enables `invoke_skill` fails validation and cannot start (DEXTO-2849, slice 6).

## What Changes

- The model picker adds the models the person's Dexto account serves (`GET /v1/models`), after the session's model, favorites and recents.
- A reasoning picker (`thought_level`) appears when the session's model reasons, with the model's variants; choosing one updates the session.
- A model that needs a key or a Dexto sign-in fails with ACP's `auth_required` error saying what to set or run, both when it is chosen and when a session starts on it.
- `dexto acp` starts on the person's saved model once setup has saved one, for any agent, including one named with `--agent`; an explicit `--model` still wins. A saved model on another provider no longer keeps the agent's endpoint or key, here and in the interactive CLI.
- Loading an agent config renames the builtin tool `invoke_skill` to `skill_load`, so installed agents from older releases still load.
- Core: a model switch to another provider no longer inherits the previous provider's `baseURL`.

## Capabilities

### Modified Capabilities

- `acp-server`: account models, reasoning effort, key errors and saved preferences.

## Impact

- `packages/cli/src/cli/commands/acp/acp-models.ts` (new), `acp-agent.ts`, `packages/cli/src/index-main.ts` (ACP bootstrap only), `packages/cli/src/config/cli-overrides.ts` (`applyUserPreferences`).
- `packages/agent-management/src/config/loader.ts`.
- `packages/core/src/llm/resolver.ts`: the `baseURL` rule on a provider change, which the TUI's model switch also gets.
