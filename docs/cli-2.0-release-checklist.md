# CLI 2.0 release readiness — 11 November 2026

**Decision: keep npm `latest` on 1.17.0.** The registry read on 11 November returned
`next = 2.0.0-beta.4`, `latest = 1.17.0`. Nothing was published or retagged during this audit.
Readiness for review does not imply readiness to deploy, publish, or merge.

This is a source and local-test audit. No production endpoints, accounts, provider authorization,
payments or credentials were accessed. The production compatibility comparison uses the committed
`origin/production` source at `18ea4909e46e4cb3a5bd4ab76d18d2fc54370d78`, not a live deployment probe.
GitHub and Linear snapshots are dated 11 November; recheck them at the release decision.

## Release gates

- [x] Merge main in a separate branch and submit [PR #1204](https://github.com/truffle-ai/dexto/pull/1204).
      Head `5dbab99e33242ced0ca008ff57bb335a9f808983`, main parent
      `0d955d50fb1b4b52bc18b13dc2d4dad67138e92e`, CLI parent
      `1cf2a4c0f5e08fd1d9ab7809f17e7aee7ab4ddaa`.
      Frozen pnpm install, build, generated OpenAPI, 5,799 tests (5,774 passed, 25 skipped), lint,
      typecheck and Hono inference passed locally. Review and merge remain human actions.
- [ ] Require final-head CI, standalone smoke on all five OS/architecture targets, and review
      resolution for every included PR. No unresolved inline review threads were returned for the
      six feature PRs at discovery. A later connector review found browser-organization, Linear account-selection and Slack revocation issues; regression fixes and final thread resolution are required before release.
- [ ] Decide the inclusion of connector sign-in, credit status/top-up, local import and LFS handoff.
      Do not present an unfinished import slice as complete Projects/native transcript migration.
- [ ] Resolve the consent design hold (DEXTO-2486 / screen 9); this lane intentionally did not edit it.
- [ ] Fix the beta workflow's retained-package guard before beta.5; details below.
- [ ] Obtain release-owner acceptance of the auth, cloud, packaging, docs and upgrade checks below.

## Open PRs targeting cli-2.0

Every open PR returned by `gh pr list --state open --base cli-2.0 --limit 100` is listed here.
The checklist itself is [PR #1205](https://github.com/truffle-ai/dexto/pull/1205). PRs are never merged by this lane.

| PR                                                     | Scope                                                                     | Release action                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [#1204](https://github.com/truffle-ai/dexto/pull/1204) | Merge main into cli-2.0 (11 Nov)                                          | Merge-main prerequisite; review conflict resolutions and final CI.                                                                  |
| [#1191](https://github.com/truffle-ai/dexto/pull/1191) | Add CLI connector sign-in commands (DEXTO-2755)                           | Connector CLI: require cloud #3855 and its #3854 parent; final CI and review.                                                       |
| [#1154](https://github.com/truffle-ai/dexto/pull/1154) | Add CLI credit top-up and status commands (DEXTO-2492)                    | Credits CLI: require cloud #3798 and billing approval; final CI and review.                                                         |
| [#1126](https://github.com/truffle-ai/dexto/pull/1126) | Preserve LFS objects when moving a chat (DEXTO-2541)                      | LFS handoff: inspect final review/CI and include before claiming complete working-tree moves.                                       |
| [#1078](https://github.com/truffle-ai/dexto/pull/1078) | Request Project/chat permissions and disclose step-up scopes (DEXTO-2486) | Consent screen: HOLD for Rahul's design pick; explicitly skipped.                                                                   |
| [#1048](https://github.com/truffle-ai/dexto/pull/1048) | Add text-only local chat import discovery and consent (DEXTO-1813)        | Local import: text-only discovery/consent slice; native transcript, Projects, attachments and skill provenance remain release gaps. |

Cloud companion inventory:

| PR                                                                      | Dependency / remaining work                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [cloud #3855](https://github.com/truffle-ai/dexto-cloudflare/pull/3855) | Connectors; stacked on [#3854](https://github.com/truffle-ai/dexto-cloudflare/pull/3854). Shared attempt-table SQL approval and rollout must precede connector availability. Main's Slack access storage and owner-scoped CLI completion must both survive. |
| [cloud #3798](https://github.com/truffle-ai/dexto-cloudflare/pull/3798) | Credits; already ready at discovery. Billing hold remains; Dodo idempotency behavior is not provider-verified. SQL bytes unchanged, reordered after main's schema. 136 focused billing/deletion/route tests pass on isolated PostgreSQL.                    |
| [cloud #3426](https://github.com/truffle-ai/dexto-cloudflare/pull/3426) | 1.x 426 pointer; 23 worker-handler tests pass. Coordinate with docs and 2.0 promotion; the message says `@latest`, which currently still installs 1.x.                                                                                                      |
| [cloud #3021](https://github.com/truffle-ai/dexto-cloudflare/pull/3021) | Separate move-to-Dexto skill draft associated with import; no full import claim until its source/native/provenance contracts are verified.                                                                                                                  |

## Open issues and scope decisions

GitHub issues cannot target a base branch. To avoid silently omitting possible blockers, the table
below inventories **every open OSS issue** returned by the repository query. Runtime issues need
release-owner triage; their existence alone does not establish a new 2.0 blocker.

| Issue                                                  | Title                                                                                                   | Triage                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [#987](https://github.com/truffle-ai/dexto/issues/987) | Docs: add OpenLLM (local OpenAI-compatible endpoint) to Supported LLM Providers                         | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#920](https://github.com/truffle-ai/dexto/issues/920) | Avoid the redundant post-model conversation-history read                                                | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#916](https://github.com/truffle-ai/dexto/issues/916) | OrcaRouter provider support for Dexto                                                                   | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#898](https://github.com/truffle-ai/dexto/issues/898) | Dexto, analysis by Claude and comparison with other memory systems                                      | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#883](https://github.com/truffle-ai/dexto/issues/883) | [BUG] dexto A2A `taskId` is promoted into local session authority                                       | Assess CLI/runtime impact before release; verify reproduction and acceptance. |
| [#836](https://github.com/truffle-ai/dexto/issues/836) | Track OpenRouter max effort support for Claude Fable 5                                                  | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#773](https://github.com/truffle-ai/dexto/issues/773) | Make file-tool external directory access approval-driven                                                | Assess CLI/runtime impact before release; verify reproduction and acceptance. |
| [#761](https://github.com/truffle-ai/dexto/issues/761) | Agent 'coding-agent' not found in registry                                                              | Assess CLI/runtime impact before release; verify reproduction and acceptance. |
| [#759](https://github.com/truffle-ai/dexto/issues/759) | Define typed runtime storage contracts for core-owned agent state                                       | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#753](https://github.com/truffle-ai/dexto/issues/753) | Add curated @dexto/core/config facade and move @dexto/agent-config off root imports                     | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#743](https://github.com/truffle-ai/dexto/issues/743) | Queued follow-up messages persist across interrupted runs but do not resume until the next user message | Assess CLI/runtime impact before release; verify reproduction and acceptance. |
| [#691](https://github.com/truffle-ai/dexto/issues/691) | Separate built-in and extensible error typing in DextoRuntimeError and Issue                            | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#689](https://github.com/truffle-ai/dexto/issues/689) | Replace internal/runtime enums and remaining error-code enums with const-list-derived unions            | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#688](https://github.com/truffle-ai/dexto/issues/688) | Replace remaining browser/public enums with const-list-derived unions                                   | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#687](https://github.com/truffle-ai/dexto/issues/687) | Tracker: remove remaining TypeScript enums from OSS packages                                            | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#679](https://github.com/truffle-ai/dexto/issues/679) | Add subpath exports to @dexto/core for per-domain imports                                               | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#649](https://github.com/truffle-ai/dexto/issues/649) | truffle-ai/dexto has a Nerq Trust Score of 83.4/100 — verified badge available                          | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#605](https://github.com/truffle-ai/dexto/issues/605) | CLI: persist per-model reasoning overrides and show effective budget tokens                             | Assess CLI/runtime impact before release; verify reproduction and acceptance. |
| [#587](https://github.com/truffle-ai/dexto/issues/587) | Add standalone installer (dexto.ai/install) + release artifacts                                         | Assess CLI/runtime impact before release; verify reproduction and acceptance. |
| [#255](https://github.com/truffle-ai/dexto/issues/255) | improve logging documentation                                                                           | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#254](https://github.com/truffle-ai/dexto/issues/254) | Enhance validation testing: Security, performance, and real-world scenarios                             | Assess CLI/runtime impact before release; verify reproduction and acceptance. |
| [#247](https://github.com/truffle-ai/dexto/issues/247) | Add .md, .txt., .doc/.docx and other file formats support                                               | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#141](https://github.com/truffle-ai/dexto/issues/141) | License choice                                                                                          | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#117](https://github.com/truffle-ai/dexto/issues/117) | Feature: Agent based CI/CD for dexto, using dexto                                                       | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#116](https://github.com/truffle-ai/dexto/issues/116) | Feature: Enable Preview Mode in the Dexto Project to see the changes of the Web UI                      | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#98](https://github.com/truffle-ai/dexto/issues/98)   | Feature: In-built scheduler into dexto                                                                  | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#87](https://github.com/truffle-ai/dexto/issues/87)   | Enhance MCP client functionality to support roots & sampling                                            | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#71](https://github.com/truffle-ai/dexto/issues/71)   | Feature: Dynamic Settings & Live Config Reloading                                                       | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#22](https://github.com/truffle-ai/dexto/issues/22)   | Add trigger based starting mechanism for agents                                                         | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |
| [#9](https://github.com/truffle-ai/dexto/issues/9)     | Feature: Long term memory layer                                                                         | Unassigned to cli-2.0; classify as blocker or follow-up explicitly.           |

Linear was read only. The complete nonterminal result set from the `CLI 2.0` title/description
search is below. This includes adjacent 2.1, orchestration, acquisition and OSS work; each requires
an explicit inclusion/defer decision, not an assumption that all are 2.0 blockers. Separately read
DEXTO-2755, 2480, 2492, 1813 and 2466. DEXTO-2849 is excluded as requested: research already exists.

| Issue                                                                                                                                                                                                                                                                        | State at audit | Release decision                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------- |
| [DEXTO-2827](https://linear.app/truffleai/issue/DEXTO-2827/cli-20-screen-9-the-signal-pass-on-the-browser-approve-and-consent) — CLI 2.0 screen 9: the Signal pass on the browser approve and consent pages                                                                  | In Review      | Owner to classify as release gate or deferred scope. |
| [DEXTO-1998](https://linear.app/truffleai/issue/DEXTO-1998/cli-consolidate-the-open-source-dexto-cli-with-the-cloud-cli-plan) — CLI: consolidate the open-source dexto CLI with the cloud CLI (plan first)                                                                   | In Review      | Owner to classify as release gate or deferred scope. |
| [DEXTO-2551](https://linear.app/truffleai/issue/DEXTO-2551/cli-list-a-chats-runtime-outputs) — CLI: list a chat's runtime outputs                                                                                                                                            | In Review      | Owner to classify as release gate or deferred scope. |
| [DEXTO-2466](https://linear.app/truffleai/issue/DEXTO-2466/cli-20-cut-the-1x-local-agent-commands-as-listed-in-the-inventory) — CLI 2.0: cut the 1.x local-agent commands, as listed in the inventory                                                                        | In Review      | Owner to classify as release gate or deferred scope. |
| [DEXTO-2376](https://linear.app/truffleai/issue/DEXTO-2376/cli-hand-off-client-keep-secrets-and-history-out-of-the-bundle-and) — CLI hand-off client: keep secrets and history out of the bundle and patch (DEXTO-2043 conditions)                                           | Triage         | Owner to classify as release gate or deferred scope. |
| [DEXTO-2483](https://linear.app/truffleai/issue/DEXTO-2483/article-x-thread-agents-dogfooding-and-hill-climbing-the-dexto-cli) — Article + X thread: agents dogfooding and hill-climbing the Dexto CLI                                                                       | Backlog        | Owner to classify as release gate or deferred scope. |
| [DEXTO-1742](https://linear.app/truffleai/issue/DEXTO-1742/agent-first-dexto-cli-the-default-door-for-agents-to-everything-dexto) — Agent-first Dexto CLI: the default door for agents to everything Dexto offers                                                            | In Progress    | Owner to classify as release gate or deferred scope. |
| [DEXTO-1672](https://linear.app/truffleai/issue/DEXTO-1672/cli-revamp-move-the-dexto-cli-towards-amp-style-cloud-cli-master) — CLI revamp: move the Dexto CLI towards Amp-style cloud CLI (master)                                                                           | Backlog        | Owner to classify as release gate or deferred scope. |
| [DEXTO-1813](https://linear.app/truffleai/issue/DEXTO-1813/cli-import-chats-and-projects-from-claude-code-and-codex-into-dexto) — CLI: import chats and Projects from Claude Code and Codex into Dexto with one command (acquisition funnel, agent-drivable)                 | Up next        | Owner to classify as release gate or deferred scope. |
| [DEXTO-2486](https://linear.app/truffleai/issue/DEXTO-2486/agent-search-p2-cut-oauthscope-friction-4-approvals-and-state-the) — Agent search P2: cut OAuth/scope friction (4 approvals) and state the $5 sign-up credit consistently                                         | In Progress    | Hold for design pick; skipped.                       |
| [DEXTO-2043](https://linear.app/truffleai/issue/DEXTO-2043/cli-21-15-security-ok-chat-sync-on-by-default-and-uploading-working) — CLI 2.1 · 15. Security OK: chat sync on by default, and uploading working trees                                                            | In Review      | Owner to classify as release gate or deferred scope. |
| [DEXTO-2305](https://linear.app/truffleai/issue/DEXTO-2305/cli-21-14c-retire-appscloud-cli) — CLI 2.1 · 14c. Retire apps/cloud-cli                                                                                                                                           | Backlog        | Owner to classify as release gate or deferred scope. |
| [DEXTO-2535](https://linear.app/truffleai/issue/DEXTO-2535/polish-chat-start-agent-schema-confirmation-and-combined-consent) — Polish chat-start agent schema, confirmation and combined consent                                                                             | In Review      | Owner to classify as release gate or deferred scope. |
| [DEXTO-2045](https://linear.app/truffleai/issue/DEXTO-2045/cli-21-13-hand-off-cloud-moves-a-chat-to-its-cloud-computer-local) — CLI 2.1 · 13. Hand-off: /cloud moves a chat to its cloud computer, /local brings it back                                                     | In Review      | Owner to classify as release gate or deferred scope. |
| [DOS-108](https://linear.app/truffleai/issue/DOS-108/revamp-oss-cli-and-libraries-through-independently-releasable-slices) — Revamp OSS CLI and libraries through independently releasable slices                                                                            | In Progress    | Owner to classify as release gate or deferred scope. |
| [DOS-128](https://linear.app/truffleai/issue/DOS-128/retire-stale-cli-integration-modes-and-audit-optional-distribution) — Retire stale CLI integration modes and audit optional distribution surfaces                                                                       | Backlog        | Owner to classify as release gate or deferred scope. |
| [DEXTO-1770](https://linear.app/truffleai/issue/DEXTO-1770/cli-overview-name-apps-and-group-them-and-list-locked-operations-with) — CLI overview: name apps and group them, and list locked operations with the scope that unlocks them                                      | Backlog        | Owner to classify as release gate or deferred scope. |
| [DEXTO-2492](https://linear.app/truffleai/issue/DEXTO-2492/top-up-credits-headlessly-in-one-click-from-the-cli-stripe-link-or-a) — Top up credits headlessly / in one click from the CLI (Stripe Link or a payments CLI)                                                     | In Progress    | Owner to classify as release gate or deferred scope. |
| [DEXTO-2518](https://linear.app/truffleai/issue/DEXTO-2518/promote-dexto-20-to-npm-latest-then-point-old-clis-at-it) — Promote dexto 2.0 to npm latest, then point old CLIs at it                                                                                            | Triage         | Owner to classify as release gate or deferred scope. |
| [DEXTO-2303](https://linear.app/truffleai/issue/DEXTO-2303/cli-21-14a-v1skills-a-persons-skills-library-for-local-harnesses) — CLI 2.1 · 14a. /v1/skills: a person's Skills library for local harnesses                                                                      | In Review      | Owner to classify as release gate or deferred scope. |
| [DEXTO-2755](https://linear.app/truffleai/issue/DEXTO-2755/cli-connector-sign-in-and-connection-management) — CLI connector sign-in and connection management                                                                                                                | In Review      | Owner to classify as release gate or deferred scope. |
| [DEXTO-2482](https://linear.app/truffleai/issue/DEXTO-2482/an-orchestrator-cant-read-a-chat-runs-outcome-or-cost-the-chat-shows) — An orchestrator can't read a chat run's outcome or cost: the chat shows "idle", and billing rows show $0 while the balance drops          | Up next        | Owner to classify as release gate or deferred scope. |
| [DOS-117](https://linear.app/truffleai/issue/DOS-117/align-oss-mcp-sdk-with-current-releases-in-validated-slices) — Align OSS MCP SDK with current releases in validated slices                                                                                              | In Progress    | Owner to classify as release gate or deferred scope. |
| [DEXTO-2484](https://linear.app/truffleai/issue/DEXTO-2484/rank-dexto-high-in-agent-search-seoaeo-run-by-agents) — Rank Dexto high in agent search (SEO/AEO), run by agents                                                                                                  | In Progress    | Owner to classify as release gate or deferred scope. |
| [DEXTO-2481](https://linear.app/truffleai/issue/DEXTO-2481/agent-started-chats-cant-pick-a-browser-profile-each-one-loads-the) — Agent-started chats can't pick a browser profile: each one loads the person's personal profile, and parallel chats don't say which they got | In Review      | Owner to classify as release gate or deferred scope. |
| [DOS-129](https://linear.app/truffleai/issue/DOS-129/docs-add-openllm-local-openai-compatible-endpoint-to-supported-llm) — Docs: add OpenLLM (local OpenAI-compatible endpoint) to Supported LLM Providers                                                                   | Backlog        | Owner to classify as release gate or deferred scope. |

The import issue explicitly records an unverified upper bound for in-flight R2 writes and prohibits
shipping the current staging design as complete. Keep native import and unverified personal-skill
uploads disabled until that contract and provenance/retry behavior are verified. Rahul's own-history
acceptance remains outstanding; only synthetic fixtures were used here.

## Per-command test coverage

The built merged CLI's `--audit-agent-cli` reports **127 registered command leaves**. Every leaf is
listed below. The audit confirms registration/output flags, not complete behavior coverage.
The source scan below identifies test files containing an argv array beginning with the exact
command words. **An argv match is evidence to inspect, not line/branch coverage or proof that all
error paths pass.** “Gap” means no such direct argv evidence was found; registration/parity or a
shared handler may still be tested. Before stable release, inspect each cited assertion and close
or accept each gap. Tests of generic `workspace call` do not cover every hosted operation.

| Command                           | Direct argv test evidence / gap                                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accounts list`                   | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `accounts remove`                 | [run.test.ts](../packages/cli/src/cli/cloud/run.test.ts)                                                                                                                                                                       |
| `accounts use`                    | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `billing`                         | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `chat browser-profiles`           | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `chat computers`                  | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `chat delete`                     | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `chat follow`                     | [workspace.test.ts](../packages/cli/src/cli/cloud/commands/workspace.test.ts)                                                                                                                                                  |
| `chat history`                    | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `chat import`                     | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `chat list`                       | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `chat local`                      | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `chat move`                       | [run.test.ts](../packages/cli/src/cli/cloud/run.test.ts), [chat-move.test.ts](../packages/cli/src/cli/cloud/commands/chat-move.test.ts)                                                                                        |
| `chat outputs`                    | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `chat start`                      | [workspace.test.ts](../packages/cli/src/cli/cloud/commands/workspace.test.ts)                                                                                                                                                  |
| `chat watch`                      | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud agents approve`            | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud agents archive`            | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud agents chat`               | [safe-output.test.ts](../packages/cli/src/cli/cloud/safe-output.test.ts), [commands.test.ts](../packages/cli/src/cli/cloud/commands/commands.test.ts)                                                                          |
| `cloud agents create`             | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud agents get`                | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud agents list`               | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud agents messages`           | [safe-output.test.ts](../packages/cli/src/cli/cloud/safe-output.test.ts)                                                                                                                                                       |
| `cloud agents reject`             | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud agents runs get`           | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud agents runs list`          | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud agents runs steps`         | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud agents sessions cancel`    | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud agents sessions delete`    | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud agents sessions get`       | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud agents sessions list`      | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud agents update`             | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud api`                       | [safe-output.test.ts](../packages/cli/src/cli/cloud/safe-output.test.ts), [run.test.ts](../packages/cli/src/cli/cloud/run.test.ts)                                                                                             |
| `cloud automations create`        | [safe-output.test.ts](../packages/cli/src/cli/cloud/safe-output.test.ts), [commands.test.ts](../packages/cli/src/cli/cloud/commands/commands.test.ts)                                                                          |
| `cloud automations delete`        | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud automations firings`       | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud automations get`           | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud automations list`          | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud automations pause`         | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud automations resume`        | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud automations rotate-secret` | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud automations run`           | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud automations update`        | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud data-deletions create`     | [commands.test.ts](../packages/cli/src/cli/cloud/commands/commands.test.ts)                                                                                                                                                    |
| `cloud data-deletions get`        | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud data-deletions list`       | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud fetch`                     | [commands.test.ts](../packages/cli/src/cli/cloud/commands/commands.test.ts)                                                                                                                                                    |
| `cloud files delete`              | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud files download`            | [safe-output.test.ts](../packages/cli/src/cli/cloud/safe-output.test.ts), [commands.test.ts](../packages/cli/src/cli/cloud/commands/commands.test.ts)                                                                          |
| `cloud files get`                 | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud files list`                | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud files upload`              | [commands.test.ts](../packages/cli/src/cli/cloud/commands/commands.test.ts)                                                                                                                                                    |
| `cloud files url`                 | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud functions deploy`          | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud functions list`            | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud models get`                | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud models list`               | [commands.test.ts](../packages/cli/src/cli/cloud/commands/commands.test.ts)                                                                                                                                                    |
| `cloud models run`                | [commands.test.ts](../packages/cli/src/cli/cloud/commands/commands.test.ts)                                                                                                                                                    |
| `cloud models runs get`           | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud models runs list`          | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud projects create`           | [run.test.ts](../packages/cli/src/cli/cloud/run.test.ts)                                                                                                                                                                       |
| `cloud projects list`             | [run.test.ts](../packages/cli/src/cli/cloud/run.test.ts)                                                                                                                                                                       |
| `cloud projects use`              | [run.test.ts](../packages/cli/src/cli/cloud/run.test.ts)                                                                                                                                                                       |
| `cloud sandboxes cat`             | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud sandboxes create`          | [commands.test.ts](../packages/cli/src/cli/cloud/commands/commands.test.ts)                                                                                                                                                    |
| `cloud sandboxes delete`          | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud sandboxes exec`            | [safe-output.test.ts](../packages/cli/src/cli/cloud/safe-output.test.ts), [commands.test.ts](../packages/cli/src/cli/cloud/commands/commands.test.ts)                                                                          |
| `cloud sandboxes export`          | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud sandboxes get`             | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud sandboxes import`          | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud sandboxes list`            | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud sandboxes ls`              | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud sandboxes pause`           | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud sandboxes rm`              | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud sandboxes start`           | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud sandboxes write`           | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud search`                    | [commands.test.ts](../packages/cli/src/cli/cloud/commands/commands.test.ts)                                                                                                                                                    |
| `cloud secrets create`            | [commands.test.ts](../packages/cli/src/cli/cloud/commands/commands.test.ts)                                                                                                                                                    |
| `cloud secrets delete`            | [commands.test.ts](../packages/cli/src/cli/cloud/commands/commands.test.ts)                                                                                                                                                    |
| `cloud secrets get`               | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud secrets list`              | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud secrets update`            | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud sites delete`              | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `cloud sites deploy`              | [commands.test.ts](../packages/cli/src/cli/cloud/commands/commands.test.ts)                                                                                                                                                    |
| `cloud sites list`                | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `connect claude`                  | [connections.test.ts](../packages/cli/src/cli/cloud/commands/connections.test.ts)                                                                                                                                              |
| `connect codex`                   | [connections.test.ts](../packages/cli/src/cli/cloud/commands/connections.test.ts)                                                                                                                                              |
| `connections disconnect`          | [connections.test.ts](../packages/cli/src/cli/cloud/commands/connections.test.ts)                                                                                                                                              |
| `connections list`                | [connections.test.ts](../packages/cli/src/cli/cloud/commands/connections.test.ts)                                                                                                                                              |
| `connections status`              | [connections.test.ts](../packages/cli/src/cli/cloud/commands/connections.test.ts)                                                                                                                                              |
| `find`                            | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `login`                           | [help.test.ts](../packages/cli/src/cli/screens/help.test.ts), [screens.test.ts](../packages/cli/src/cli/screens/screens.test.ts)                                                                                               |
| `logout`                          | [screens.test.ts](../packages/cli/src/cli/screens/screens.test.ts)                                                                                                                                                             |
| `models list`                     | [run.test.ts](../packages/cli/src/cli/cloud/run.test.ts)                                                                                                                                                                       |
| `profile get`                     | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `profile update`                  | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `projects create`                 | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `projects delete`                 | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `projects get`                    | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `projects list`                   | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `projects move`                   | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `projects run`                    | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `projects start`                  | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `projects update`                 | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `publish`                         | [screens.test.ts](../packages/cli/src/cli/screens/screens.test.ts), [workspace.test.ts](../packages/cli/src/cli/cloud/commands/workspace.test.ts)                                                                              |
| `review`                          | [register.test.ts](../packages/cli/src/cli/commands/review/register.test.ts)                                                                                                                                                   |
| `run`                             | [help-json.test.ts](../packages/cli/src/cli/help-json.test.ts), [screens.test.ts](../packages/cli/src/cli/screens/screens.test.ts), [register.test.ts](../packages/cli/src/cli/commands/run/register.test.ts)                  |
| `skills push`                     | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `skills sync`                     | [commands.test.ts](../packages/cli/src/cli/cloud/commands/commands.test.ts)                                                                                                                                                    |
| `span list`                       | [traces.test.ts](../packages/cli/src/cli/cloud/commands/traces.test.ts)                                                                                                                                                        |
| `trace list`                      | [traces.test.ts](../packages/cli/src/cli/cloud/commands/traces.test.ts)                                                                                                                                                        |
| `trace view`                      | [traces.test.ts](../packages/cli/src/cli/cloud/commands/traces.test.ts)                                                                                                                                                        |
| `uninstall`                       | [upgrade.test.ts](../packages/cli/src/cli/commands/upgrade.test.ts), [uninstall.test.ts](../packages/cli/src/cli/commands/uninstall.test.ts), [self-management.test.ts](../packages/cli/src/cli/utils/self-management.test.ts) |
| `upgrade`                         | [screens.test.ts](../packages/cli/src/cli/screens/screens.test.ts)                                                                                                                                                             |
| `whoami`                          | [screens.test.ts](../packages/cli/src/cli/screens/screens.test.ts), [run.test.ts](../packages/cli/src/cli/cloud/run.test.ts)                                                                                                   |
| `workspace artifacts create`      | [artifacts.test.ts](../packages/cli/src/cli/cloud/commands/artifacts.test.ts)                                                                                                                                                  |
| `workspace artifacts get`         | [artifacts.test.ts](../packages/cli/src/cli/cloud/commands/artifacts.test.ts)                                                                                                                                                  |
| `workspace artifacts list`        | [artifacts.test.ts](../packages/cli/src/cli/cloud/commands/artifacts.test.ts)                                                                                                                                                  |
| `workspace artifacts replace`     | [artifacts.test.ts](../packages/cli/src/cli/cloud/commands/artifacts.test.ts)                                                                                                                                                  |
| `workspace artifacts share`       | [artifacts.test.ts](../packages/cli/src/cli/cloud/commands/artifacts.test.ts)                                                                                                                                                  |
| `workspace call`                  | [workspace.test.ts](../packages/cli/src/cli/cloud/commands/workspace.test.ts)                                                                                                                                                  |
| `workspace computers keys create` | [computer-keys.test.ts](../packages/cli/src/cli/cloud/commands/computer-keys.test.ts)                                                                                                                                          |
| `workspace computers keys list`   | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `workspace computers keys revoke` | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `workspace describe`              | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `workspace drive put`             | Gap: add a direct behavior test or document the shared-handler evidence.                                                                                                                                                       |
| `workspace tools`                 | [workspace.test.ts](../packages/cli/src/cli/cloud/commands/workspace.test.ts)                                                                                                                                                  |

Draft additions are outside that 127-command snapshot: `connect <connector>` has start/wait,
attempt resume, no-browser/no-wait, disconnect and failure tests in `connections.test.ts`;
`credits balance`, `credits topup` and `credits topup status` have command/wait/error tests in
`credits.test.ts`; `import` and `import list` have discovery, selection, redaction, consent and
fail-closed transport/provenance tests in the import branch. Updated branch runs passed
1,148 connector, 1,160 credit and 1,171 import CLI/cloud-client tests. These totals include shared
tests and are not counts of feature-specific tests.

- [ ] Check each mutating command: noninteractive consent refusal sends no mutation; `--yes`
      and `--json` behave as documented; stdout contains only the contracted JSON/NDJSON.
- [ ] Check each long-running command: start once, bound each read, retry only idempotent reads,
      honor Retry-After/deadlines, emit one final NDJSON record, exit 6 on deadline/input, 130 on Ctrl-C,
      and never cancel remote work just because a follow stops.
- [ ] Check auth expiry, missing scope, wrong organization, malformed server output, 429/5xx,
      terminal control text and network interruption across the public command boundaries.
- [ ] Add/accept gaps in the table, including account/profile, agent-management and generic cloud
      command families; a green registration audit is not sufficient for promotion.

## Upgrade from 1.x and documentation

- [ ] Publish the actual removed-command table at
      `https://cli.dexto.ai/docs/guides/cli/overview#removed-in-20` before the 426 pointer depends on it.
      Check setup, agents, init, mcp and every other inventory removal against the table.
- [ ] Verify the literal 426 body, status, plain-text content type and `cache-control: no-store`
      using old 1.6–1.8 clients in a controlled local/preview environment. Preserve 426: those clients
      replace 403/404 bodies with fixed text and hide the upgrade instructions.
- [ ] Keep the 426 promotion timing coordinated: `pnpm add -g dexto@next` is the beta path;
      the proposed 426 message says `npm i -g dexto@latest` and only points at 2.0 after promotion.
- [ ] Build docs, test the anchor and redirects, and reconcile the CLI README, installer,
      examples, cloud scopes, JSON/NDJSON exit-code reference and first-run instructions.
- [ ] Review removed Docker/web/server examples and old `apps/cloud-cli` links. Document native
      dependency/Node support and command replacements without suggesting unsupported 1.x modes.
- [ ] Installer and upgrade smoke: fresh install, 1.17.0 to beta.5, beta.4 to beta.5, local config/
      history preserved, failed download recovery, uninstall and Windows/macOS/Linux binaries.

## Package contents: publication dry run

Used pnpm as required: `pnpm --dir packages/cli pack --json --pack-destination <local-artifact-dir>`.
This creates a local npm-format tarball without publishing; pnpm 10.12.4 has no `pack --dry-run`.
The merged-source artifact `dexto-1.14.4.tgz` contained **433 files**, **382,491 compressed bytes**,
**1,326,124 unpacked bytes**, `dist/index.js`, the README and configured agent/assets. It contained
no test artifacts, `.env` files, or unresolved `workspace:` dependencies. File names and manifests
were inspected; secret values were not read.

**This is not a releasable beta.5 artifact.** Repo CLI/cloud-client versions remain 1.14.4, while
main advanced shared packages to 1.17.0. The beta workflow performs ephemeral versioning. The CLI
manifest also has no `engines` field; settle and test the supported Node versions explicitly.

- [ ] Repeat packing after ephemeral beta.5 versioning; verify CLI `2.0.0-beta.5`, all internal
      versions and the complete dependency closure, executable entry, licenses and bundled assets.
- [ ] Install the actual tarball in an empty project on supported Node/OS combinations; check
      `--version`, `--help`, `--help --json`, a local headless fixture, auth failure and native SQLite.
- [ ] Verify there are no credential/config/history files, source-only tools or unexpected assets.
      Pin artifact checksum and file manifest in the release review.

## Auth and production cloud-contract compatibility

- [x] Source snapshot: all **232 vendored MCP tool names and complete input-schema records** in
      the merged CLI match production-branch source exactly; no missing or changed entries.
- [x] Defaults are `https://app.dexto.ai` for OAuth/MCP and `https://api.dexto.ai` for `/v1`;
      `@dexto/cloud-client` sends Bearer auth and `Dexto-Cloud-Project` for a person's selected project.
- [ ] Recheck `/v1` generated types against the exact release cloud source, including operation
      IDs, envelopes, Retry-After and cloud-project selection; MCP equality does not prove HTTP parity.
- [ ] Verify browser PKCE/state, headless device flow, profile switching, refresh/revocation,
      scope step-up and expired credentials in an authorized nonproduction test environment. Never
      retry a start/mutation after a missing-scope grant if work has already started.
- [ ] Require connector/cloud #3854/#3855 and credit/cloud #3798 contracts to be deployed before
      including those commands as supported. Current production-source catalog matching applies to
      the base CLI; it does not prove these draft operations are live.
- [ ] Validate Owner-only credit settlement/replay/account deletion, same-organization cross-user
      connector refusal, opaque attempt IDs and no local provider tokens. Provider grants/payments
      need explicit authorized test-mode verification; none was attempted in this lane.
- [ ] Record the exact cloud release commit accepted by the release owner. A Git branch named
      production is source evidence, not proof of which binary is serving requests.

## November call additions: imports, connections and headless onboarding

- [ ] Land the Claude-export extension of CLI #1048 and its paired cloud contract before
      advertising `dexto chat import --from claude-export export.zip`. Published beta.4 reads
      local Claude Code/Codex sessions only. Export import must create private chats, stable
      Projects and ordinary Project knowledge files; preview redacted text before upload.
- [ ] Run the synthetic end-to-end fixtures through the actual CLI runner: the
      `~/.claude/projects/<encoded-path>/<session>.jsonl` layout and a Claude ZIP containing
      `conversations.json` and `projects.json` with `docs`. Verify dry-run sends no requests,
      legacy/structured text is not duplicated, retries reuse IDs/files, malformed or ambiguous
      metadata is refused, and explicit Project membership is preserved. Exports without
      membership leave chats unassigned; do not infer it from names. Binary attachments remain
      outside this text import. Native attachment staging remains a separate release gate.
- [ ] Publish and exercise `docs/docs/guides/cli/import-claude.md`: install `@next`, person-owned
      device sign-in, list, dry-run, consent, import and partial-failure retry. Update its beta.4
      caveat once the supported release is actually available.
- [ ] DEXTO-2923: exercise an already connected fake X account through `connections list`,
      capability search, describe and call. The CLI must not start another connector sign-in to
      use an existing connection. #1191 carries this regression; local fake-provider evidence
      does not certify a real production X grant.

### Recommendation for memories and CLAUDE.md (Rahul decision required)

Recommend retaining imported Claude memories, `CLAUDE.md`, `AGENTS.md`, `MEMORY.md` and Project
instructions as **ordinary text files in the Project**, under an import-specific folder whose
names do not activate Dexto instructions. Do not automatically create Dexto memories or skills.
These texts may contain stale policy, prompt injection, private details or machine-specific
paths. A memory is recalled automatically; a skill needs a deliberate trigger, scope and usable
procedure. Neither is a safe one-to-one translation of arbitrary export text.

After review, a person can select individual facts for Dexto memory and reusable procedures for
skills. Keep provenance and a preview of each proposed conversion. **This recommendation is not
implemented:** the new export path defers these categories, and the server refuses instructions
or memories when `sourceAgent=claude_export`. Existing coding-agent Project import behavior is
unchanged. Rahul must choose retention/conversion behavior before anyone builds it.

### Headless sign-up and top-up (DEXTO-2492)

- [ ] Test from an empty home and signed-out noninteractive shell. Distinguish **new-account
      sign-up** from device login to an existing account. The CLI must return a structured next
      action and let the person complete required identity verification; it must not approve
      its own grant. Current `login --device` alone is not evidence of headless new-account
      sign-up. Establish the supported signup/verification contract and documentation before
      calling that flow complete.
- [ ] Test `credits balance`, `credits topup` and `credits topup status` from a headless shell:
      explicit billing scope, person consent, machine-readable checkout URL/ID and resume
      command, no browser requirement, bounded reads, expiry/cancel/failure outcomes and retry
      without creating another checkout. Settlement must credit once, and `--yes` must not
      manufacture payment approval. Use an authorized payment test mode; no real purchase is
      part of this lane. CLI #1154 and cloud #3798 remain paired, with the billing hold visible.

## Published CLI security and chat-computer permission audit

`npm pack --dry-run --json --ignore-scripts` inspected the published `dexto@1.17.0` and
`dexto@2.0.0-beta.4` packages. Downloaded tarballs matched their registry SHA-512 integrity and
dry-run file inventories: 427 regular files / 3,662,662 unpacked bytes and 391 / 1,196,377 bytes.
Every file was checked against all 29 admin MCP names and admin endpoints/scopes: no hits.
An ordinary-account local MCP fixture lists no admin tools and refuses their names; the separate
admin MCP enforces its own resource, admin scopes and operator identity. Existing admin/OAuth
tests passed 61/61 against disposable loopback Postgres. No package leak was found. This is
artifact and current-source/local-test evidence, not production verification.

The reported full-scope Claude Code CLI bypass is absent in the inspected source: chat computers
receive a short-lived, owner/org/computer/run/session-bound capability token for
`capabilities:sources/search/describe/call` and `nova:models/chat`, held by the root broker, not a
personal CLI OAuth login. Membership and live run are rechecked. Claude Code computer tokens
are refused at `/api/capabilities`; its Worker relay applies `resolveTurnPhasePermissions` and
the run's `platformToolIds`. DEXTO-2925's regression is already in cloud #4099. The defensive gap
where a generic run token does not itself encode narrowed tool IDs is addressed by cloud #4107
(DEXTO-2936); review that existing fix rather than create a competing credential path.

- [ ] Recheck the exact release cloud head and runtime bootstrap, including no account login
      installed by the host, ordinary versus staff listings, operator/resource gates, narrowed
      run tokens, expired/revoked membership and mandatory approvals. A manual person sign-in
      inside a computer is a separate credential grant and must not be confused with bootstrap.

## Concrete beta.5 cut plan (not executed)

1. Review/merge the chosen CLI PRs and #1204 through normal human review. Leave the consent pick,
   billing hold and unverified import scope visible. Re-run all repo checks on the resulting head.
2. Prepare a release-workflow PR on cli-2.0. Keep `dexto` independent from fixed-version `@dexto/*`.
   `scripts/cli-beta-packages.txt` already requests CLI base `2.0.0` and shared base `1.17.0`, but
   omits `llm`, `registry`, `client-sdk`. Their manifests/source changed after the retained
   `@dexto/llm@1.16.1` tag, so the current workflow's retained-package diff **fails after #1204**.
   Include those three in dependency order (and any newly required public dependents), update the
   retained-package assertion/comment, and run `node scripts/check-cli-beta-packages.mjs`.
   The current 19-package closure passes, but that does not validate the stale retained-package pin.
3. Use the existing manual `.github/workflows/publish-cli-beta.yml`, branch `cli-2.0`, input
   `beta=5`. It versions the checkout ephemerally to `dexto@2.0.0-beta.5` and selected
   `@dexto/*@1.17.0-beta.5`, builds, then publishes only under `next` in dependency order. No repo
   version bump or changesets prerelease is required for this existing path. Prefer adding a
   pack/validation-only mode and fail-closed registry-error handling in the workflow PR before use.
4. Before authorizing that workflow, pack the exact ephemeral versions locally and in CI, verify
   no `workspace:` references or unavailable internal versions, run the empty-project/native
   install matrix, attach artifact checksums, and confirm beta.5 is not already published. Do not
   use `publish-cli-1x.yml`, whose major-1 guard and `latest` behavior are a different release path.
5. A release owner may dispatch beta.5 only after approval. Verify `next=2.0.0-beta.5` and
   `latest=1.17.0` afterwards. This audit did not dispatch the workflow or publish anything.
6. For stable 2.0, resolve all accepted blockers, prepare the independent CLI stable version and
   shared-package release plan, docs/426 timing, rollback instructions and signed-off smoke
   evidence. Main's `changesets-publish.yml` runs only from main, so it is not a cli-2.0 stable
   release workflow. Add/review a deliberate stable release path before changing `latest`.
   Dist-tag promotion is a separate, explicitly authorized human release action.
