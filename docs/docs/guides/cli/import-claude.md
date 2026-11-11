---
title: Import Claude chats
sidebar_position: 5
---

# Import Claude chats

Use a Dexto 2.0 build with Claude export support. The currently published
`2.0.0-beta.4` supports local Claude Code and Codex sessions only; the ZIP commands
below require the next release after the import PR and its cloud contract land.

1. Install the next CLI and check its version:

    ```sh
    pnpm add -g dexto@next
    dexto --version
    ```

2. Sign in as the person whose private chats and Projects will receive the import:

    ```sh
    dexto login --device
    dexto whoami --json
    ```

    Give the person the displayed link and code. Wait for their approval; an agent
    must not approve sign-in for them. API keys cannot import workspace chats.

3. For Claude web chats, open Claude **Settings → Privacy → Export data** and
   download the ZIP. Keep the ZIP on the local machine. List its chats and Projects:

    ```sh
    dexto chat local --from claude-export ./export.zip --json
    ```

4. Preview exactly the redacted transcript text and Project knowledge files:

    ```sh
    dexto chat import --from claude-export ./export.zip --dry-run --json
    ```

    Review that output locally with the person. Redaction is best effort; inspect
    remaining text before uploading. Memories, Project instructions and files named
    `CLAUDE.md`, `AGENTS.md` or `MEMORY.md` are deferred. Tool calls become inert
    transcript text. Binary attachments are not imported; extracted attachment text
    is included when the export provides it. Chats remain unassigned when the
    export has no explicit Project membership; names are never used to guess it.

5. Once the person agrees, import the same ZIP:

    ```sh
    dexto chat import --from claude-export ./export.zip --yes --json
    ```

    To select chats, append their IDs after the ZIP path in both preview and import
    commands. Selecting chats imports only their explicitly associated Projects.
    Repeating the same ZIP reuses its source IDs; unchanged knowledge files are not
    uploaded again. A partial failure exits 1 and lists failed items; rerun to resume.

For local Claude Code sessions, use their normal `~/.claude/projects` layout:

```sh
dexto chat local --from claude-code --json
dexto chat import --from claude-code --all --dry-run --json
dexto chat import --from claude-code --all --yes --json
```

Use session IDs instead of `--all` to choose particular sessions. `--dir` overrides
the local session root. `--from codex` reads local Codex sessions instead. These
local commands import text transcripts; they do not copy local instruction files
or memories.

Claude export instructions: [Export your Claude data](https://support.claude.com/en/articles/9450526-export-your-claude-data).
