## Context

Both transports share discovery. Add the three task scopes there so they cannot drift. Preserve explicit additional scopes, deduplication, and scopes actually returned by the token server.

## Goals / Non-Goals

Allow normal chat, Loop and Project work after one approval. Do not request every write scope or automatically upgrade stored credentials.

## Decisions

Use one fixed, reviewable task-scope list. Server default scopes remain unchanged. Cloud's existing single consent page lists all requested permissions and preserves code matching and organization choice.

## Risks / Trade-offs

An approved CLI can start paid agent work and change/delete Projects and Loops. Keep billing top-up, secret import, approval answering, deployment and computer-management writes explicit. Deploy cloud disclosure first; merge after security OK. Rollback restores the former request set but does not revoke already approved grants; users can revoke in Settings or log out.
