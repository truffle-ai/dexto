---
'dexto': patch
'@dexto/tui': patch
'@dexto/agent-management': patch
---

With `DEXTO_PALETTE=signal`, the first run, `dexto login` (browser and `--device`), `whoami`, errors, `--help` and the update notice use the Signal look. Without it, output is unchanged. `@dexto/agent-management` sign-in now hands the CLI a prompt to show (`SignInPrompt`) and says why a sign-in ended (`SignInEnded`).
