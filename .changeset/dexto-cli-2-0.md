---
'dexto': major
---

dexto 2.0: one CLI for local agents and Dexto Cloud.

- `dexto login` signs you in with your browser or a device code, with profiles (`--org`, `--profile`, `dexto accounts`), `dexto whoami` and `dexto logout`. 1.x's saved API key and `dexto-cloud` sign-ins carry over once; `DEXTO_API_KEY` and `--api-key` still work. `dexto auth …` is gone.
- Dexto models run on your sign-in and bill your organization's credits in a Cloud project; `dexto models list` and `dexto billing` read it, and the status line shows your credits. Signed in, every local session gets the Dexto MCP.
- `dexto cloud …` builds in Dexto Cloud (projects, agents, automations, files, sandboxes, secrets, sites, functions, models, search, fetch, data deletions, api); `dexto workspace`, `dexto find`, `dexto publish`, `dexto profile` and `dexto skills push` use your workspace.
- One output contract: JSON when stdout isn't a terminal, failures as `{"error":{"code","message","fix"}}` on stderr, exit codes 0–6, and `dexto --help --json`. `dexto run` takes `--json` and `--stream-json` instead of `--format`.
- `dexto session …` is `dexto chat …`; `dexto chat local|import` bring Claude Code and Codex chats into Dexto.
- Removed: `dexto deploy` and `--cloud-agent` (use `dexto cloud sites|functions deploy`), and `dexto trace` and `dexto span` until `/v1` serves run traces.

See packages/cli/RELEASE-NOTES-2.0.md.
