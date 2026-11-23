## Context

ACP `AuthMethod` entries of type `terminal` give `args` (and optional `env`) for the client to run the agent's own command with. The SDK says the args are added to the agent's command; the registry's documentation says they replace the agent's args. The registry's CI only sends `initialize` with `_meta["terminal-auth"]: true` and checks that `authMethods` has a terminal or agent entry; it never calls `authenticate`.

## Decisions

- **Offer only a terminal method.** `dexto login` already runs the browser sign-in and stores the credential; an agent-run method would duplicate it. Clients that cannot run a terminal get no methods, as before.
- **Accept both capability markers.** `auth.terminal` is the protocol's field; `_meta["terminal-auth"]` is what the registry's checks and older clients send.
- **`dexto acp login` aliases `dexto login`.** With args `login --scope cloud:write`, a client that appends runs `dexto acp login …` and one that replaces runs `dexto login …`. Both reach the same cloud `login` command, with the same output and exit code.
- **Scope `cloud:write`.** It is the scope that lets Dexto models spend credits, which is what a person signing in from an ACP app needs.
- **No `authenticate` handling.** A client runs the terminal command itself; `authenticate` stays a no-op, and a model without a sign-in still fails with `auth_required`.
