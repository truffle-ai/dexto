## Why

DEXTO-2486: the first workspace-read sign-in makes agents retry consent for Projects, chats and traces.

## What Changes

Request only `projects:write`, `sessions:write`, `runs:read` and `artifacts:read` on top of today's set in browser and device login. Keep `computers:write` and `automations:write` as explicit step-ups. Interactive recovery lists the complete discovered request before re-login; headless/JSON commands exit 3 naming the missing scope. Existing tokens keep their scopes; the new set is requested at the next login or step-up.

## Capabilities

### New Capabilities

- `cli-task-scopes`: One initial sign-in for Project chats and their output, with explicit step-ups for direct computer writes and Loops.

### Modified Capabilities

None.

## Impact

Agent-management sign-in requests and CLI help. Cloud must first show chat and Loop spending warnings. No Core changes or new API fields. Merge after security OK.
