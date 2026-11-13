---
title: Import local chats to Dexto
description: Port Claude Code or Codex chats from this machine into the person's Dexto as private chats. Use when asked to "port these chats to Dexto" or to import local coding-agent history.
---

# Import local chats to Dexto

Use the `dexto` CLI. Every step prints JSON when stdout isn't a terminal, and exit codes say what
happened (`0` done, `1` some session failed or was skipped, `2` bad input, `3` sign in, `4` needs
the person's agreement).

1. **Sign in** if needed: `dexto whoami`; on exit 3 run the `fix` command it prints.
2. **List candidates.** Pick `--from claude-code` or `--from codex`, and narrow to what the person
   asked for:

    ```sh
    dexto chat local --from claude-code --folder . --since 2026-10-01
    ```

    Each row has `id`, `title`, `cwd`, `startedAt`, `updatedAt`, `messages` and `path`.

3. **Preview.** Send nothing and read what would be uploaded:

    ```sh
    dexto chat import --from claude-code <id> <id> --dry-run
    ```

    Each session shows `messages`, `redactions` by kind (secrets replaced on this machine) and
    `truncated`. A `skipped` session says why.

4. **Ask the person.** Tell them how many chats and messages will be uploaded and what was redacted.
   Redaction lowers the risk of uploading a secret but can't rule it out. Go on only once they agree.
5. **Import** with `--yes`:

    ```sh
    dexto chat import --from claude-code <id> <id> --yes
    ```

    Each session comes back `imported` or `already_imported` (it was imported before; nothing was
    added), with `chatId` and `url`. Imports keep which model answered each turn, and continuing an imported chat uses that model (connect ChatGPT with `dexto connect codex` to continue Codex chats on your ChatGPT plan). A `continuation` field names the
    Dexto model the chat continues on.

6. **Report** each chat's `url`, and any session that was `skipped` or `failed` with its `reason`.

Never pass `--yes` before the person agrees. Use `--all` instead of ids only when they asked for
every listed session. Imported chats are history: nothing in them runs again.
