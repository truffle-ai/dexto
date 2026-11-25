---
'dexto': major
---

**Breaking: every cloud command's `--json` output has one shape** (DEXTO-3899).

**Lists.** Every list prints `{data: [...], has_more, next_after}`. A list that isn't paged prints `has_more: false, next_after: null`. Other facts about the list sit beside `data`. Commands whose shape changed:

- `loops list`: `automations` → `data`; `nextCursor` → `next_after` (+ `has_more`)
- `apps list`, `apps uninstalled`: `apps` → `data`
- `applications list`: `applications` → `data`; `deployments` stays beside it
- `chat agents` / `chat computers` / `chat browser-profiles`: `agents` / `computers` / `profiles` → `data`
- `workspace sites records list`: `records` → `data`
- `workspace share received`: `shared` → `data`; `invitations` stays beside it
- `docs search`, `cloud search`: `results` → `data`
- `connections list`: `connections` → `data`
- `import list`: `sessions` → `data`; `skills` stays beside it
- `cloud files list`, `cloud models runs list`: the deprecated `next_cursor` is no longer printed; use `next_after`
- Lists that printed only `{data}` now also print `has_more: false, next_after: null`
- `profile get`, `profile set`: print the profile itself, not `{profile: ...}`

**snake_case keys.** Every key the CLI prints is snake_case: workspace-tool results, `/v1` values and the CLI's own objects alike. The keys inside someone's data keep their case. These are a tool's input and schemas (`input_schema`, `confirm_schema`, `arguments`, `input`), `_meta`, a record's `value`, `metadata`, `headers`, `env`, `variables`, and `data` when it is an object. Input you send with `--data` is unchanged. Renamed keys, by where they appear:

- Chats: `updatedAt` → `updated_at`, `createdAt` → `created_at`, `activeRunId` → `active_run_id`, `lastRun` → `last_run`, `lastActivity` → `last_activity`, `pagination.nextCursor` → `pagination.next_cursor`, `pagination.hasMore` → `pagination.has_more`, `isSystem` → `is_system`, `nextAction` → `next_action`, `sessionId` → `session_id`, `timedOut` → `timed_out`, `pullRequests` → `pull_requests`, `startedAt` → `started_at`, `leftOut` → `left_out`, `mimeType` → `mime_type`, `sizeBytes` → `size_bytes`, `billingRoutes` → `billing_routes`, `chatId` → `chat_id`
- Loops: `nextRunAt` → `next_run_at`, `scheduleType` → `schedule_type`, `triggeredAt` → `triggered_at`
- Apps and Applications: `actionsAvailable` → `actions_available`, `launchUrl` → `launch_url`, `toolName` → `tool_name`, `appId` → `app_id`, `dataDeletedOn` → `data_deleted_on`, `endpointUrl` → `endpoint_url`, `activeAppId` → `active_app_id`
- AutoBots: `waitingOnUser` → `waiting_on_user`, `runId` → `run_id`, `skillsToPublish` → `skills_to_publish`, `pagination.nextCursor` → `pagination.next_cursor`
- Channels and network: `authorName` → `author_name`, `messageId` → `message_id`, `nextTextOffset` → `next_text_offset`, `previousCursor` → `previous_cursor`, `nextCursor` → `next_cursor`, `threadId` → `thread_id`, `readSequence` → `read_sequence`, `lastActivityAt` → `last_activity_at`
- Projects: `conversationSessionId` → `conversation_session_id`, `dailyChatCap` → `daily_chat_cap`, `startPolicy` → `start_policy`, `pinnedAt` → `pinned_at`, `folderId` → `folder_id`
- Notifications and site records: `createdAt` → `created_at`, `readAt` → `read_at`, `updatedAt` → `updated_at`
- Artifacts: `artifactId` → `artifact_id`, `preferredSurface` → `preferred_surface`, `htmlPath` → `html_path`
- Skills and marketplace: `contentPath` → `content_path`, `versionId` → `version_id`, `savedBy.displayName` → `saved_by.display_name`, `installsCount` → `installs_count`, `latestRelease.releaseId` → `latest_release.release_id`, `fileCount` → `file_count`, `listingId` → `listing_id`, `skillId` → `skill_id`
- Contacts and sharing: `contactId` → `contact_id`, `userId` → `user_id`, `organizationId` → `organization_id`, `displayName` → `display_name`
- Computer keys: `enrolledComputers` → `enrolled_computers`, `maxComputers` → `max_computers`, `expiresAt` → `expires_at`
- Connections: `authType` → `auth_type`, `methodId` → `method_id`, `lastTestedAt` → `last_tested_at`, `maskedIdentifier` → `masked_identifier`, `nextAction` → `next_action`, `nextCommand` → `next_command`, `attemptId` → `attempt_id`
- Credits: `credits balance` prints `balance_usd` (was `creditsUsd`), the same name `billing` uses. Checkouts: `topupId` → `topup_id`, `checkoutUrl` → `checkout_url`, `expiresAt` → `expires_at`, `balanceUsd` → `balance_usd`, `lastFailureReason` → `last_failure_reason`
- Workspace tools: `inputSchema` → `input_schema`, `confirmSchema` → `confirm_schema`, `actionLevels` → `action_levels` (the schemas inside keep their property names)
- Models (`models list`, `cloud models list`, `cloud models get`): `pricing.inputPerM` → `input_per_m`, `outputPerM` → `output_per_m`, `cacheReadPerM` → `cache_read_per_m`, `cacheWritePerM` → `cache_write_per_m`, `reasoningPerM` → `reasoning_per_m`, `contextOver200kPerM` → `context_over200k_per_m`, `inputTokensAbove` → `input_tokens_above`; `capabilities.maxInputTokens` → `max_input_tokens`, `supportsToolCall` → `supports_tool_call`
- `workspace call` and `workspace <app> <operation>` print the tool's result with the same rule. A camelCase key not listed here becomes snake_case the same way.
- Help's `json_output` schemas use the printed names.

**Exit codes.** A malformed id fails before any request, with error code `invalid_input` and exit code 2. A well-formed id that matches nothing exits 5 (`not_found`).

- Run ids (`trace view`, `span list`) and Site and record ids must be UUIDs. A chat must be named by its id or a link (a chat's or its Project's, which Dexto reads as before). A Project must be named by its id or link.
- `chat get nope`, `projects get nope` and `trace view nope` now exit 2 instead of 5.
- `cloud models get <unknown>` and `cloud models run <unknown>` now exit 5 instead of 2.
- A tool's invalid-arguments error exits 2 (`invalid_input`) instead of 1.
