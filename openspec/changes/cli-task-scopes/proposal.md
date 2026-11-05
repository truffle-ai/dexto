## Why

DEXTO-2486: read-only first sign-in makes agents retry consent to start chats and Loops.

## What Changes

Request `sessions:write`, `automations:write` and `projects:write` alongside current reads in both browser and device login. Keep unrelated writes explicit. Existing tokens do not gain permissions; existing users must consent again.

## Capabilities

### New Capabilities

- `cli-task-scopes`: One initial sign-in for normal chat, Loop and Project work.

### Modified Capabilities

None.

## Impact

Agent-management sign-in requests and CLI help. Cloud must first show chat and Loop spending warnings. No Core changes or new API fields. Merge after security OK.
