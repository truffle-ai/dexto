## Context

The Dexto session store is per agent, not per project: the TUI and `dexto acp` in any project share it. Each session records the workspace it was created in (`workspaceId`), and the CLI sets the workspace to the project root at start. Core already generates titles on demand (`generateSessionTitleDetails`); the TUI calls it after a session's first message.

## Decisions

- **Listing is scoped to the project:** only sessions whose `workspaceId` is the served workspace are listed, each with `cwd` set to the project root. A `cwd` in another project is refused, as for `session/new`. Without a `cwd` the process's project is used, starting the agent if no session has yet.
- **No paging:** all of the project's sessions are returned at once, newest first. Local stores are small, and the TUI lists them the same way.
- **Resume shares load's checks:** both start the agent for the project, refuse an unknown session with `sessionNotFound`, and register it on the connection; only load replays the history.
- **Close keeps the history:** it removes the session from the connection, aborts its turn, waits for the run to wind down, then calls `endSession`, which frees the in-memory session but keeps the stored history. Deleting history is not offered.
- **Titles after the first prompt:** once a prompt ends, the session is titled in the background, so the prompt's answer is not delayed. A session that already has a title is skipped, so later prompts send nothing. Title failures are logged to stderr.

## Risks / Trade-offs

Titling costs one short model call per new session, as in the TUI. A client that closes the connection right after the first prompt may miss the title update; it is still stored and listed.
