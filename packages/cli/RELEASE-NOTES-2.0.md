# dexto 2.0 release notes (draft)

Draft for DEXTO-2031. Each 2.0 change a 1.x user notices is listed here as it lands on `cli-2.0`.

## Signing in

- `dexto login` signs you in to Dexto in your browser, or with a code on any device (`--device`, chosen by itself over SSH). It replaces 1.x's login, which minted an API key.
- Sign-ins are saved per profile in `~/.dexto/accounts/`: `--org`, `--profile`, `dexto accounts list|use|remove`, `dexto whoami`. `dexto logout` ends the sign-in on the server.
- A 1.x saved API key (`~/.dexto/auth.json`) and `dexto-cloud` preview sign-ins carry over once. `DEXTO_API_KEY` and `--api-key` still work for CI.
- `dexto auth login|logout|status` are gone: use `dexto login`, `dexto logout` and `dexto whoami`.

## Dexto models and the Dexto MCP

- Dexto models (shown as Dexto, `dexto/<model>`) run on your sign-in and bill your organization's credits in a Cloud project, chosen when you sign in (`dexto cloud projects use` changes it). Spending credits asks for that permission the first time.
- `dexto models list` and `dexto billing` read your sign-in. The status line shows your credits while a Dexto model runs, and running out offers a top-up or your own model key.
- Signed in, every local session gets the Dexto MCP (your connectors, Drive, Sites and Apps, Loops and memory) as a server named `dexto`.

## Dexto Cloud and your workspace from the terminal

- `dexto cloud` builds in Dexto Cloud: `projects`, `agents`, `automations`, `files`, `sandboxes`, `secrets`, `sites`, `functions`, `models`, `search`, `fetch`, `data-deletions` and `api`. 1.x's `dexto cloud sources|search|describe` are gone; `dexto find` replaces them.
- `dexto workspace` uses your workspace as you; `dexto publish`, `dexto profile` and `dexto skills push` are new.
- Every cloud command, and `login`, `logout`, `whoami`, `accounts`, `models list` and `billing`, prints JSON when stdout isn't a terminal (`--json` or `--table` to choose), failures as `{"error":{"code","message","fix"}}` on stderr, and exits 0 done, 1 failed, 2 usage, 3 needs sign-in or permission, 4 needs `--yes`, 5 not found, 6 waiting on a person.

## Output

- `dexto run` prints JSON when stdout isn't a terminal, and the reply at one. `--json` prints one result and `--stream-json` prints events ending with one `result`; they replace `--format json|jsonl`, and `--text` forces the reply. JSON keys are snake_case (`session_id`, `total_tokens`), the version field is gone, refused approvals are `permission_denials`, and an empty prompt exits 2.

- `dexto --help --json` lists every command and the exit codes. Notices (an available update, server and web startup banners) go to stderr, so stdout carries only a command's output.

## Renamed and removed

- `dexto session list|history|delete` are now `dexto chat list|history|delete`. `dexto chat local` and `dexto chat import` bring Claude Code and Codex chats into Dexto.
- `dexto deploy` (1.x workspace deploys) is gone: its service no longer exists. Deploy Sites and Functions with `dexto cloud sites deploy` and `dexto cloud functions deploy`. `dexto --cloud-agent`, which chatted with a workspace deploy, is gone with it.
- `dexto trace` and `dexto span` are gone, because the CLI now uses only Dexto's public `/v1` API and the Dexto MCP. They come back when `/v1` serves run traces.
