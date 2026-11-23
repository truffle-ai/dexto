## 1. Sessions

- [x] 1.1 Advertise `sessionCapabilities` `list`, `resume` and `close`.
- [x] 1.2 `session/list`: this project's sessions, newest first, with title and last activity.
- [x] 1.3 `session/resume`: reopen a stored session without replay; share load's checks.
- [x] 1.4 `session/close`: cancel and wait for the running turn, then end the session in memory.
- [x] 1.5 Title a session after its first prompt and send `session_info_update`.
- [x] 1.6 Integration tests: one title update across prompts; list and resume across processes with persistent storage, skipping and refusing another project's session; close cancelling a running turn without a title; a session reopened while its close waits runs a full prompt.
