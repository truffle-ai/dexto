## Why

`dexto acp` can create and load sessions, but an ACP client cannot see which sessions exist, cannot reopen one without replaying it, cannot close one, and never learns a session's title. T3 Code and Zed show a session list with titles, so Dexto sessions look nameless and get lost between runs.

## What Changes

- `session/list` returns this project's stored Dexto sessions, most recently active first, with their titles and last activity. Sessions from the TUI in the same project are listed too.
- `session/resume` reopens a stored session without replaying its history.
- `session/close` cancels the session's running turn, waits for it to end, and ends the session in memory; its history stays for a later load or resume.
- After a session's first prompt, Dexto titles it the way the TUI does (a short model-written title, or one taken from the message) and sends a `session_info_update`.
- `initialize` advertises `sessionCapabilities` `list`, `resume` and `close`.

Part 4 of DEXTO-2849; it builds on `cli-acp-server`.

## Capabilities

### Modified Capabilities

- `acp-server`: session list, resume, close and titles.

## Impact

- `packages/cli/src/cli/commands/acp`.
- No core changes. It uses `listSessions`, `getSessionMetadata`, `getWorkspace`, `endSession` and `generateSessionTitleDetails`.
