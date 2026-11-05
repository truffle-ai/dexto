## Context

Both transports share discovery. Add two task-write and two task-read scopes there so they cannot drift. Preserve advertised reads, explicit and previously granted scopes, deduplication, server-returned scopes and the existing chat-sync setting. Run traces and storage-artifact resources have separate read scopes outside workspace metadata.

## Goals / Non-Goals

Allow Project chats and output reads after one approval. Keep direct computer writes and recurring Loops as step-ups. Do not automatically upgrade stored credentials.

## Decisions

Use one fixed task-scope list. Server defaults remain unchanged. Before an interactive step-up starts authorization, the shared discovery path supplies the exact request to the prompt; declining opens no approval page and does not retry the command. The prompt covers current defaults, old scopes, chat sync and the missing scope. Cloud's all-or-nothing consent page preserves code matching and organization choice; the CLI offers no narrower grant option.

## Risks / Trade-offs

An approved default token can start paid chats and change/delete/share Projects with the organization. Direct shell/file writes can bypass hosted approvals, and Loops can spend after revocation: those two permissions stay explicit. Billing top-up, secret import, approval answering and deployment writes also stay explicit. Deploy cloud disclosure first; merge after security OK. Revocation immediately stops token access but does not stop existing chats or Loops. Rollback restores the old request set without revoking approved grants.
