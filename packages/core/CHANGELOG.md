# @dexto/core

## 1.1.11

### Patch Changes

- 0760f8a: Fixes to postgres data parsing and url env parsing.
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
