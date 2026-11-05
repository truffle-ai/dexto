## Why

DEXTO-2486: read-only first sign-in makes agents retry consent to start chats and Loops.

## What Changes

Request `runs:read`, `artifacts:read`, `sessions:write`, `automations:write`, `projects:write` and `computers:write` alongside current reads in both browser and device login. The additional reads cover run traces and tool-produced storage artifacts, whose scopes the workspace metadata omits. Keep unrelated writes explicit. Existing tokens do not gain permissions; existing users must consent again.

## Capabilities

### New Capabilities

- `cli-task-scopes`: One initial sign-in for normal chat, Loop, Project and computer work.

### Modified Capabilities

None.

## Impact

Agent-management sign-in requests and CLI help. Cloud must first show chat and Loop spending warnings. No Core changes or new API fields. Merge after security OK.
