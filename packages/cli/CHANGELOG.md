# dexto

## 1.1.11

### Patch Changes

- 2b81734: Updated WebUI for MCP connection flow and other minor updates
- 5cc6933: Fixes for prompts/resource management, UI improvements, custom slash command support, add support for embedded/linked resources, proper argument handling for prompts
- 40f89f5: Add New Agent buttons, form editor, new APIs, Dexto class
- 01167a2: Refactors
- a53b87a: feat: Redesign agent registry system with improved agent switching
    - **@dexto/core**: Enhanced agent registry with better ID-based resolution, improved error handling, and normalized registry entries
    - **dexto**: Added agent switching capabilities via API with proper state management
    - **@dexto/webui**: Updated agent selector UI with better UX for switching between agents
    - Agent resolution now uses `agentId` instead of `agentName` throughout the system
    - Registry entries now require explicit `id` field matching the registry key

- 24e5093: Add customize agent capabilities
- c695e57: Add blob storage system for persistent binary data management:
    - Implement blob storage backend with local filesystem support
    - Add blob:// URI scheme for referencing stored blobs
    - Integrate blob storage with resource system for seamless @resource references
    - Add automatic blob expansion in chat history and message references
    - Add real-time cache invalidation events for resources and prompts
    - Fix prompt cache invalidation WebSocket event handling in WebUI
    - Add robustness improvements: empty text validation after resource expansion and graceful blob expansion error handling
    - Support image/file uploads with automatic blob storage
    - Add WebUI components for blob resource display and autocomplete
- Updated dependencies [0760f8a]
- Updated dependencies [5cc6933]
- Updated dependencies [40f89f5]
- Updated dependencies [01167a2]
- Updated dependencies [a53b87a]
- Updated dependencies [24e5093]
- Updated dependencies [c695e57]
    - @dexto/core@1.1.11

## 1.1.10

### Patch Changes

- 0f4d181: Add skip setup flag
    - @dexto/core@1.1.10

## 1.1.9

### Patch Changes

- 27778ba: Add claude 4.5 sonnet and make it default
- Updated dependencies [27778ba]
    - @dexto/core@1.1.9

## 1.1.8

### Patch Changes

- 35d82cc: Add github agent and update registry
- d79d358: Add agent toggle functionality to webui
- d79d358: Add new functions for agent management to DextoAgent()
- Updated dependencies [d79d358]
    - @dexto/core@1.1.8

## 1.1.7

### Patch Changes

- 4216e79: Add auto approve flag
    - @dexto/core@1.1.7

## 1.1.6

### Patch Changes

- e6d029c: Update logos and fix build
    - @dexto/core@1.1.6

## 1.1.5

### Patch Changes

- 11cbec0: Update READMEs and docs
- dca7985: Simplify CLI session management with -c/-r flags and streamlined session commands
    - Add -c/--continue flag to resume most recent session
    - Add -r/--resume <sessionId> flag to resume specific session
    - Remove redundant session commands (new, switch, current)
    - Update default behavior to create new sessions
    - Simplify help text and command descriptions

- 9d7541c: Add posthog telemetry
- Updated dependencies [e2bd0ce]
- Updated dependencies [11cbec0]
- Updated dependencies [795c7f1]
- Updated dependencies [9d7541c]
    - @dexto/core@1.1.5

## 1.1.4

### Patch Changes

- de49328: Update dependencies
- 2fccffd: Migrating to monorepo
- Updated dependencies [2fccffd]
    - @dexto/core@1.1.4
