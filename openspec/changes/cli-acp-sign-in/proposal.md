## Why

The ACP Registry lists only agents that offer a sign-in method a client can run, either in a terminal or inside the agent. `dexto acp` offers none, so it cannot be listed, and an ACP app has no way to sign a person in to Dexto: they must leave the app and run `dexto login --scope cloud:write` themselves (DEXTO-3607).

## What Changes

- `initialize` offers a terminal sign-in method, **Sign in to Dexto** (`dexto-login`), to clients that can run one: those that declare `auth.terminal`, or the older `_meta["terminal-auth"]` marker that the registry's checks send. It runs `login --scope cloud:write`.
- New `dexto acp login` behaves exactly like `dexto login`, so the method works whether the client adds its args after `acp` or in place of it.

## Capabilities

### Modified Capabilities

- `acp-server`: a terminal sign-in method.

## Impact

- `packages/cli/src/cli/commands/acp/acp-agent.ts`, `register.ts`; `packages/cli/agent-audit-baseline.json` gains `acp login`.
- `docs/docs/guides/cli/acp.md` mentions the sign-in.
