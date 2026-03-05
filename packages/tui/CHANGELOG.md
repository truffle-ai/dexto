# @dexto/tui

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
