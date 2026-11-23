## Context

The Dexto session store is per agent, not per project: the TUI and `dexto acp` in any project share it. Each session records the workspace it was created in (`workspaceId`), and the CLI sets the workspace to the project root at start. Core already generates titles on demand (`generateSessionTitleDetails`); the TUI calls it after a session's first message.

## Decisions

- **Listing is scoped to the project:** only sessions whose `workspaceId` is the served workspace are listed, each with `cwd` set to the project root. A `cwd` in another project is refused, as for `session/new`. Without a `cwd` the process's project is used, starting the agent if no session has yet.
- **No paging:** all of the project's sessions are returned at once, newest first. Local stores are small, and the TUI lists them the same way.
- **Resume shares load's checks:** both start the agent for the project, refuse an unknown session, or one recorded in another workspace, with `sessionNotFound`, and register it on the connection; only load replays the history.
- **Close keeps the history:** it removes the session from the connection, aborts its turn, waits for the run and any title being made to end, then calls `endSession`, which frees the in-memory session but keeps the stored history. Deleting history is not offered. A closed session is not titled, and a title made while it closes is not sent. Loads (including their history replay), resumes and closes of one session run one at a time, in the order they arrive: a reopen sent during a close waits for it, and a close sent during a load or resume waits for that, so a close never ends a session reopened after it and a reopen never undoes a close sent after it.
- **Titles after the first prompt:** once a prompt ends, the session is titled in the background, so the prompt's answer is not delayed. A session that already has a title is skipped, and so is one whose title is still being made, so the client gets exactly one title. Title failures are logged to stderr.

## Risks / Trade-offs

Titling costs one short model call per new session, as in the TUI. A client that closes the connection right after the first prompt may miss the title update; it is still stored and listed.
