# Web UI to Hono Typed Client SDK Migration Plan

## Goal

Update the Web UI to use the Hono typed client SDK (`@dexto/client-sdk`) instead of direct `fetch` or the `apiFetch` wrapper. This provides type safety for API calls and ensures consistency with the server definition.

## Important Instructions

### Type Safety & Refactoring
- **NO TYPE CASTING**: If you notice you have to type cast at any point or you have to make the API response match some different format, it's a **RED FLAG** and indicates we need to do some refactors.
- **Fix at the source**: When type issues occur, refactor the server code to return the correct types, then update the Web UI to consume these types, then remove duplicate Web UI types.
- **No explicit types for API responses**: React Query automatically infers types from Hono client. Don't create type definitions for API responses.
- **No api-types.ts file**: The Hono typed client provides complete type inference from server Zod schemas. No need for intermediate type files.

### Commit Strategy
- **Commit after each working API change**: For every working API change, commit the changes immediately.
- **No backward compatibility**: Remove `apiFetch` completely once all usages are replaced. No deprecation warnings or temporary compatibility layers.

### Migration Approach
- **One file at a time**: Migrate one file/hook at a time to validate the approach.
- **Check for issues early**: Each migration should be verified before moving to the next file.

## Migration Methodology

This is the exact pattern established for migrating ALL API calls in the webui package.

### Step 1: Fix Server Schema Types

**Always use `z.output<typeof Schema>` instead of inline types**

```typescript
// ❌ BEFORE: Inline type that drifts from schema
const servers: Array<{ id: string; name: string; status: string }> = [];

// ✅ AFTER: Use schema output type
const servers: z.output<typeof ServerInfoSchema>[] = [];
```

**Use proper Zod schemas instead of `z.record(z.any())`**

```typescript
// ❌ BEFORE: Loses type information
inputSchema: z.record(z.any())

// ✅ AFTER: Proper structured schema
const ToolInputSchemaSchema = z.object({
    type: z.literal('object'),
    properties: z.record(z.any()).optional(),
    required: z.array(z.string()).optional(),
}).passthrough();
```

### Step 2: Update WebUI Hooks - Remove Explicit Types

**Remove all explicit type annotations from React Query hooks**

```typescript
// ❌ BEFORE: Explicit type annotation
export function useServers() {
    return useQuery<McpServer[], Error>({
        queryFn: async () => {
            const data = await client.api.mcp.servers.$get().json();
            return data.servers;
        },
    });
}

// ✅ AFTER: Let TypeScript infer from Hono client
export function useServers() {
    return useQuery({
        queryFn: async () => {
            const data = await client.api.mcp.servers.$get().json();
            return data.servers; // Type inferred from server Zod schema
        },
    });
}
```

### Step 3: Components - Inline Type Inference

**Extract types inline from hook return values using `ReturnType`**

```typescript
// In component file
import { useServers } from '@/hooks/useServers';

// Infer type inline where needed (one-liner)
type McpServer = NonNullable<ReturnType<typeof useServers>['data']>[number];

function MyComponent() {
    const { data: servers } = useServers();
    const server: McpServer = servers[0]; // ✅ Fully typed
}
```

### Step 4: Remove Duplicate Types from types.ts

**Delete ANY type that represents an API response**

```typescript
// ❌ DELETE these from types.ts
export interface McpServer { ... }
export interface McpTool { ... }
export interface ToolResult { ... }
export interface GreetingResponse { ... }
// etc - ANY API response type

// ✅ KEEP only UI-specific types
export interface ServerRegistryEntry { ... }  // UI-only, not from API
export interface ServerRegistryFilter { ... }  // UI-only
```

### Why This Works

1. **Server Zod schemas** → Define response shape with proper types
2. **Hono typed client** → Extracts types from schemas automatically
3. **React Query** → Infers return type from `queryFn`
4. **Components** → Extract types from hooks using `ReturnType`

**Result**: End-to-end type safety with ZERO duplication. Server schemas are the single source of truth.

## Migration Progress

### ✅ Completed
- [x] Fix core self-referencing import (api-key-resolver.ts)
- [x] Update server schema to use z.output types (mcp.ts - ServerInfoSchema)
- [x] Add proper ToolInputSchemaSchema with properties/required fields
- [x] Migrate useServers hook - remove explicit types
- [x] Migrate useServerTools hook - remove explicit types
- [x] Update ServersPanel.tsx - remove 'unknown' status references
- [x] Clean up types.ts - remove McpServer, McpTool, ToolResult, etc.
- [x] Update Playground components to inline type inference:
  - [x] PlaygroundView.tsx
  - [x] ToolInputForm.tsx
  - [x] ToolsList.tsx

### 🚧 In Progress (Current Focus)
- [ ] Fix remaining Playground build errors
- [ ] Update remaining Playground components:
  - [ ] ServersList.tsx
  - [ ] ToolResult.tsx

### 📋 Remaining Hooks to Migrate
- [ ] useChat.ts
- [ ] useGreeting.ts
- [ ] ChatContext.tsx
- [ ] usePrompts.ts
- [ ] useResources.ts
- [ ] useSessions.ts
- [ ] useAgentConfig.ts
- [ ] useResourceContent.ts
- [ ] useSearch.ts

### 📋 Remaining Components to Migrate
- [ ] ChatApp.tsx
- [ ] InputArea.tsx
- [ ] SessionPanel.tsx
- [ ] MemoryPanel.tsx
- [ ] CreatePromptModal.tsx
- [ ] CreateMemoryModal.tsx
- [ ] ApiKeyModal.tsx
- [ ] AgentSelector/CreateAgentModal.tsx
- [ ] ModelPicker/ModelPickerModal.tsx
- [ ] ToolConfirmationHandler.tsx
- [ ] AgentSelector/AgentSelector.tsx
- [ ] lib/serverRegistry.ts

### 🗑️ Final Cleanup
- [ ] Remove apiFetch completely from api-client.ts
- [ ] Export createMessageStream from client-sdk

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
- No additional type files needed - Hono client provides full type inference

### 3. Core Hooks Migration

#### MCP Servers (Priority 1 - ✅ Complete)
**[MODIFY]** `packages/webui/components/hooks/useServers.ts`
- Replace `apiFetch` with `client.api.mcp.servers` calls
- Remove explicit type annotations from `useQuery` - let TypeScript infer from Hono client
- Remove any data transformations - return response data directly

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
- Remove `McpServer` and `McpTool` types - these are inferred from Hono client
- Keep only Web UI-specific types that aren't API responses (e.g., `ServerRegistryEntry`, UI state types)
- Any type that represents an API response should be removed and inferred from the Hono client instead

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
