# @dexto/core

## 1.2.4

### Patch Changes

- cd706e7: bump up version after fixing node-machine-id

## 1.2.3

### Patch Changes

- 5d6ae73: Bump up version to fix bugs

## 1.2.2

## 1.2.1

## 1.2.0

### Minor Changes

- 1e25f91: Update web UI to be default, fix port bugs, update docs

### Patch Changes

- b51e4d9: Add changeset for blob mimetype check patch
- a27ddf0: Add OTEL telemetry to trace agent execution
- 155813c: Add changeset for coding internal tools
- 3a65cde: Update older LLMs to new LLMs, update docs
- 5ba5d38: **Features:**
    - Agent switcher now supports file-based agents loaded via CLI (e.g., `dexto --agent path/to/agent.yml`)
    - Agent selector UI remembers recent agents (up to 5) with localStorage persistence
    - WebUI displays currently active file-based agent and recent agent history
    - Dev server (`pnpm dev`) now auto-opens browser when WebUI is ready
    - Added `/test-api` custom command for automated API test coverage analysis

    **Bug Fixes:**
    - Fixed critical bug where Memory, A2A, and MCP API routes used stale agent references after switching
    - Fixed telemetry shutdown blocking agent switches when observability infrastructure (Jaeger/OTLP) is unavailable
    - Fixed dark mode styling issues when Chrome's Auto Dark Mode is enabled
    - Fixed agent card not updating for A2A and MCP routes after agent switch

    **Improvements:**
    - Refactored `Dexto.createAgent()` to static method, removing unnecessary singleton pattern
    - Improved error handling for agent switching with typed errors (CONFLICT error type, `AgentError.switchInProgress()`)
    - Telemetry now disabled by default (opt-in) in default agent configuration
    - Added localStorage corruption recovery for recent agents list

- 930a4ca: Fixes in UI, docs and agents
- ecad345: Add changeset for allow/deny tool policies.
- 930d75a: Add mcp server restart feature and button in webUI

## 1.1.11

### Patch Changes

- c40b675: - Updated toolResult sanitization flow
    - Added support for video rendering to WebUI
- 015100c: Added new memory manager for creating, storing and managing memories.
    - FileContributor has a new memories contributor for loading memories into SystemPrompt.
- 0760f8a: Fixes to postgres data parsing and url env parsing.
- 5cc6933: Fixes for prompts/resource management, UI improvements, custom slash command support, add support for embedded/linked resources, proper argument handling for prompts
- 40f89f5: Add New Agent buttons, form editor, new APIs, Dexto class
- 3a24d08: Add claude haiku 4.5 support
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
- 0700f6f: Support for in-built and custom plugins
- 0a5636c: Added a new Approval System and support MCP Elicitations
- 35d48c5: Add chat summary generation

## 1.1.10

## 1.1.9

### Patch Changes

- 27778ba: Add claude 4.5 sonnet and make it default

## 1.1.8

### Patch Changes

- d79d358: Add new functions for agent management to DextoAgent()

## 1.1.7

## 1.1.6

## 1.1.5

### Patch Changes

- e2bd0ce: Update build to not bundle
- 11cbec0: Update READMEs and docs
- 795c7f1: feat: Add @dexto/client-sdk package
    - New lightweight cross-environment client SDK
    - HTTP + optional WebSocket support for messaging
    - Streaming and non-streaming message support
    - Session management, LLM config/catalog access
    - MCP tools integration and search functionality
    - Real-time events support
    - Comprehensive TypeScript types and validation
    - Unit tests and documentation included

- 9d7541c: Add posthog telemetry

## 1.1.4

### Patch Changes

- 2fccffd: Migrating to monorepo
