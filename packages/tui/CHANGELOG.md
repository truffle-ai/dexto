# @dexto/tui

## 1.6.23

### Patch Changes

- 8f6330b: Publish LLM usage analytics cost metrics.
    - `dexto` / `@dexto/tui`: include estimated USD cost and per-bucket cost fields in CLI LLM usage analytics.
    - `@dexto/webui`: include estimated USD cost and per-bucket cost fields in WebUI LLM usage analytics.
    - `@dexto/analytics`: extend the shared `dexto_llm_tokens_consumed` event payload with cost fields.
    - `@dexto/core`: emit `costBreakdown` alongside `estimatedCost` from shared LLM pricing metadata.
    - `@dexto/server`: forward the emitted cost breakdown through usage delivery and A2A SSE events.

- Updated dependencies [8f6330b]
- Updated dependencies [4671d88]
    - @dexto/core@1.6.23
    - @dexto/agent-management@1.6.23
    - @dexto/registry@1.6.23

## 1.6.22

### Patch Changes

- 3bf5549: Add media-aware filesystem reads and resource-backed multimodal handling.

    This expands supported file type capabilities for audio, video, and document inputs, preserves resource references for history and UI rehydration, and updates prompt/session handling to project multimodal content more reliably across core, server, and WebUI flows.

- Updated dependencies [a87712a]
- Updated dependencies [3bf5549]
    - @dexto/agent-management@1.6.22
    - @dexto/core@1.6.22
    - @dexto/registry@1.6.22

## 1.6.21

### Patch Changes

- Updated dependencies [c51501e]
- Updated dependencies [80608eb]
    - @dexto/agent-management@1.6.21
    - @dexto/core@1.6.21
    - @dexto/registry@1.6.21

## 1.6.20

### Patch Changes

- Updated dependencies [059b3d1]
    - @dexto/agent-management@1.6.20
    - @dexto/core@1.6.20
    - @dexto/registry@1.6.20

## 1.6.19

### Patch Changes

- Updated dependencies [aa54df6]
- Updated dependencies [015dd4f]
    - @dexto/core@1.6.19
    - @dexto/agent-management@1.6.19
    - @dexto/registry@1.6.19

## 1.6.18

### Patch Changes

- Updated dependencies [29bd887]
- Updated dependencies [3d4fb3d]
- Updated dependencies [beb8efa]
    - @dexto/agent-management@1.6.18
    - @dexto/core@1.6.18
    - @dexto/registry@1.6.18

## 1.6.17

### Patch Changes

- 2b4603a: Add direct cloud-agent chat support to the CLI, including agent selection, shared Ink UI support through a backend adapter layer, and cloud session,
  streaming, approval, and cancel flows. Also align cloud behavior with the local CLI for command availability, approval handling, and context clearing.
- Updated dependencies [302d1c3]
    - @dexto/core@1.6.17
    - @dexto/agent-management@1.6.17
    - @dexto/registry@1.6.17

## 1.6.16

### Patch Changes

- Updated dependencies [11acdc1]
    - @dexto/core@1.6.16
    - @dexto/agent-management@1.6.16
    - @dexto/registry@1.6.16

## 1.6.15

### Patch Changes

- Updated dependencies [6a490b0]
    - @dexto/agent-management@1.6.15
    - @dexto/core@1.6.15
    - @dexto/registry@1.6.15

## 1.6.14

### Patch Changes

- @dexto/core@1.6.14
- @dexto/agent-management@1.6.14
- @dexto/registry@1.6.14

## 1.6.13

### Patch Changes

- 8ae630a: Adds ChatGPT login via codex so users can reuse their subscriptions.
- Updated dependencies [663ac8e]
- Updated dependencies [8ae630a]
    - @dexto/agent-management@1.6.13
    - @dexto/core@1.6.13
    - @dexto/registry@1.6.13

## 1.6.12

### Patch Changes

- @dexto/core@1.6.12
- @dexto/agent-management@1.6.12
- @dexto/registry@1.6.12

## 1.6.11

### Patch Changes

- @dexto/core@1.6.11
- @dexto/agent-management@1.6.11
- @dexto/registry@1.6.11

## 1.6.10

### Patch Changes

- @dexto/core@1.6.10
- @dexto/agent-management@1.6.10
- @dexto/registry@1.6.10

## 1.6.9

### Patch Changes

- dfbabfc: Improve the `/models` picker with curated **Featured**, cross-session **Recents**, and synced **Favorites** sections across TUI/WebUI.

    Also improves featured-model selection fairness across providers and prevents stale deleted local models from being selectable.

- 1025ea7: Add session forking with visible lineage across core, API, and CLI UX:
    - Add `forkSession(parentSessionId)` in core and expose `POST /api/sessions/:sessionId/fork`.
    - Persist child lineage via `parentSessionId` and clone persisted message history.
    - Generate forked session titles as `Fork: ...` (from parent title or parent ID fallback).
    - Surface fork lineage in `/resume` and `dexto session list`, and add a new interactive `/fork` command.

- Updated dependencies [dfbabfc]
- Updated dependencies [1025ea7]
    - @dexto/agent-management@1.6.9
    - @dexto/core@1.6.9
    - @dexto/registry@1.6.9

## 1.6.8

### Patch Changes

- @dexto/core@1.6.8
- @dexto/agent-management@1.6.8
- @dexto/registry@1.6.8

## 1.6.7

### Patch Changes

- 785978b: Fix upload standalone bianries release tag finding logic
- Updated dependencies [785978b]
    - @dexto/agent-management@1.6.7
    - @dexto/core@1.6.7
    - @dexto/registry@1.6.7

## 1.6.6

### Patch Changes

- 7e2bcd2: fix windows escape sequence
- Updated dependencies [7e2bcd2]
    - @dexto/agent-management@1.6.6
    - @dexto/core@1.6.6
    - @dexto/registry@1.6.6

## 1.6.5

### Patch Changes

- 60aab0e: Fix windows build for binary distribution
- Updated dependencies [60aab0e]
- Updated dependencies [19a4983]
    - @dexto/agent-management@1.6.5
    - @dexto/core@1.6.5
    - @dexto/registry@1.6.5

## 1.6.4

### Patch Changes

- 7cb9082: Bump to test binary distribution
- Updated dependencies [7cb9082]
    - @dexto/agent-management@1.6.4
    - @dexto/core@1.6.4
    - @dexto/registry@1.6.4

## 1.6.3

### Patch Changes

- @dexto/core@1.6.3
- @dexto/agent-management@1.6.3
- @dexto/registry@1.6.3

## 1.6.2

### Patch Changes

- 1b3a411: Migrate ink-cli stuff to separate TUI package
- Updated dependencies [5e6383d]
- Updated dependencies [7b2c395]
    - @dexto/agent-management@1.6.2
    - @dexto/core@1.6.2
    - @dexto/registry@1.6.2
