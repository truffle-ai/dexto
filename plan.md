# Web UI to Hono Typed Client SDK Migration Plan

## Goal

Update the Web UI to use the Hono typed client SDK (`@dexto/client-sdk`) instead of direct `fetch` or the `apiFetch` wrapper. This provides type safety for API calls and ensures consistency with the server definition.

## Important Instructions

### Type Safety & Refactoring
- **NO TYPE CASTING**: If you notice you have to type cast at any point or you have to make the API response match some different format, it's a **RED FLAG** and indicates we need to do some refactors.
- **Fix at the source**: When type issues occur, refactor the server code to return the correct types, then update the Web UI to consume these types, then remove duplicate Web UI types.
- **Import types from core/client-sdk**: Avoid duplicating types in the Web UI. Types should ideally come from `@dexto/core` or `@dexto/client-sdk`.

### Commit Strategy
- **Commit after each working API change**: For every working API change, commit the changes immediately.
- **No backward compatibility**: Remove `apiFetch` completely once all usages are replaced. No deprecation warnings or temporary compatibility layers.

### Migration Approach
- **One file at a time**: Migrate one file/hook at a time to validate the approach.
- **Check for issues early**: Each migration should be verified before moving to the next file.

## User Review Required

**IMPORTANT**: Export `createMessageStream` from `@dexto/client-sdk` as it is currently missing from the main export but used in examples.

## Proposed Changes

### 1. Client SDK
**[MODIFY]** `packages/client-sdk/src/index.ts`
- Export `createMessageStream` and `MessageStreamEvent` from `./streaming.js`

### 2. Web UI Setup
**[NEW]** `packages/webui/lib/client.ts`
- Initialize and export the typed client using `createDextoClient`
- This will be the single source of truth for the API client

### 3. Core Hooks Migration

#### MCP Servers (Priority 1 - Already Started)
**[MODIFY]** `packages/webui/components/hooks/useServers.ts`
- Replace `apiFetch` with `client.api.mcp.servers` calls
- Update types to match Hono client responses
- Ensure `McpServer` and `McpTool` types are compatible or adapted

**[MODIFY]** `packages/webui/components/ServersPanel.tsx`
- Fix type errors related to servers array (find, length, map)
- Ensure `useServers` return type is correctly handled

#### Chat Functionality (Priority 2)
**[MODIFY]** `packages/webui/components/hooks/useChat.ts`
- Replace `EventStreamClient` and `fetch` with `client.api['message-stream'].$post` and `createMessageStream`
- Replace `fetch` for `/api/message-sync` with `client.api['message-sync'].$post`
- Replace `fetch` for `/api/reset` with `client.api.reset.$post`

### 4. All Files to Migrate

**Core Components:**
- `components/ChatApp.tsx` (also replace `fetch` for YAML export)
- `components/InputArea.tsx`
- `components/SessionPanel.tsx`
- `components/ServersPanel.tsx`
- `components/MemoryPanel.tsx`

**Modals:**
- `components/CreatePromptModal.tsx`
- `components/CreateMemoryModal.tsx`
- `components/ApiKeyModal.tsx`
- `components/AgentSelector/CreateAgentModal.tsx`
- `components/ModelPicker/ModelPickerModal.tsx`

**Hooks:**
- `components/hooks/useChat.ts` (replace `fetch` and `EventStreamClient`)
- `components/hooks/useGreeting.ts`
- `components/hooks/ChatContext.tsx`
- `components/hooks/useServers.ts` ✅ (in progress)
- `components/hooks/usePrompts.ts`
- `components/hooks/useResources.ts`
- `components/hooks/useSessions.ts`
- `components/hooks/useAgentConfig.ts`
- `components/hooks/useResourceContent.ts`
- `components/hooks/useSearch.ts`

**Other:**
- `lib/serverRegistry.ts`
- `components/ToolConfirmationHandler.tsx`
- `components/AgentSelector/AgentSelector.tsx`
- `components/Playground/PlaygroundView.tsx`

### 5. Cleanup
**[MODIFY]** `packages/webui/lib/api-client.ts`
- Remove `apiFetch` completely (no backward compatibility)

**[MODIFY]** `packages/webui/types.ts`
- Remove duplicate types that exist in `@dexto/core` or `@dexto/client-sdk`
- Keep only Web UI-specific types

## Type Issues Encountered

### Known Issues from Initial Migration
1. **McpServer type**: WebUI had `status: 'connected' | 'disconnected' | 'error' | 'unknown'` but server only returns `'connected' | 'error' | 'disconnected'` - Fixed by updating WebUI type
2. **McpTool.inputSchema**: WebUI had `JsonSchema | null` but server returns `Record<string, any>` - Fixed by updating WebUI type

### During Migration Watch For:
- Type mismatches between server response and WebUI types
- Unnecessary data transformations or mappings
- Missing fields in server responses that UI expects
- Type casting using `as` or `as any` - these are red flags!

## Verification Plan

### Automated Tests
Run existing tests to ensure no regression:
```bash
pnpm test
```

### Manual Verification Checklist
- [ ] Chat functionality (sending messages, streaming)
- [ ] MCP server management (listing, adding, removing, restarting)
- [ ] Search functionality
- [ ] Session management (history, switching)
- [ ] Prompts and Resources loading
- [ ] Model picker and LLM switching
- [ ] Agent configuration
- [ ] Tool execution and confirmation

## Progress Tracking

### Completed
- [ ] Export `createMessageStream` from client-sdk
- [ ] Create `client.ts` in webui
- [ ] Migrate `useServers.ts` and `ServersPanel.tsx`

### In Progress
- [ ] (Current file being worked on)

### Remaining
- [ ] All other files listed above

## Notes

- The migration revealed that WebUI had duplicate types to overcome limitations of `fetch`
- Client SDK/server types haven't been tested in this manner so they might be incomplete/incorrect
- When we see issues, we refactor server → update WebUI → remove duplicate types
- Goal is to have type-safe APIs directly consumable from the SDK with zero type casting
