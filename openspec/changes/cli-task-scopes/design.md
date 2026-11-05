## Context

Both transports share discovery. Add the four task-write scopes and two task-read scopes there so they cannot drift. The workspace resource only advertises scopes used by workspace operations: run traces and storage-artifact resources have separate read scopes. Preserve explicit additional scopes, deduplication, and scopes actually returned by the token server.

## Goals / Non-Goals

Allow normal chat, Loop, Project and computer work after one approval. Do not request every write scope or automatically upgrade stored credentials.

## Decisions

Use one fixed, reviewable task-scope list. Server default scopes remain unchanged. Cloud's existing single consent page lists all requested permissions and preserves code matching and organization choice.

## Risks / Trade-offs

An approved CLI can start paid agent work, change/delete Projects and Loops, and start chat computers, run shell commands with the person's GitHub access, and write/import files. Keep billing top-up, secret import, approval answering and deployment writes explicit. Deploy cloud disclosure first; merge after security OK. Rollback restores the former request set but does not revoke already approved grants; users can revoke in Settings or log out.
