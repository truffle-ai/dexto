# Web UI to Hono Typed Client SDK Migration Plan

## Goal

Update the Web UI to use the Hono typed client SDK (`@dexto/client-sdk`) instead of direct `fetch` or the `apiFetch` wrapper. This provides type safety for API calls and ensures consistency with the server definition.

## Important Instructions

### Type Safety & Refactoring
- **NO TYPE CASTIN OR ANY TYPES**: If you notice you have to type cast at any point or you have to make the API response match some different format, it's a **RED FLAG** and indicates we need to do some refactors.
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

### Step 3: Export Types from Hooks (Centralized Pattern)

**Export commonly used types from hook files to avoid duplication**

When components need to work with individual items from hook responses, export those types from the hook file:

```typescript
// useServers.ts - Export types alongside hooks
export function useServers() {
    return useQuery({
        queryFn: async () => {
            const data = await client.api.mcp.servers.$get().json();
            return data.servers;
        },
    });
}

// Export inferred types for components to use
export type McpServer = NonNullable<ReturnType<typeof useServers>['data']>[number];
export type McpTool = NonNullable<ReturnType<typeof useServerTools>['data']>[number];
```

**Components import and use the centralized types:**

```typescript
// ServersList.tsx - Import types from hook file
import { useServers } from '@/hooks/useServers';
import type { McpServer } from '@/hooks/useServers';

function ServersList({ servers }: { servers: McpServer[] }) {
    const selectedServer: McpServer = servers[0]; // ✅ Fully typed
}
```

**Benefits of centralized exports:**
- ✅ Single source of truth (no duplication across components)
- ✅ Consistent types everywhere
- ✅ Better discoverability (clear what types are available from each hook)
- ✅ Easier maintenance (change once in hook file)

**When to export types:**
- Array element types (e.g., `McpServer` from `servers[]`)
- Nested object types that components need to reference (e.g., `ValidationError` from `errors[]`)
- NOT the full hook return type (components can infer that automatically)

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
3. **React Query hooks** → Infer return type from `queryFn` (no explicit types)
4. **Hook exports** → Provide centralized type exports for components (using `ReturnType`)
5. **Components** → Import types from hooks (no duplication)

**Result**: End-to-end type safety with ZERO duplication. Server schemas are the single source of truth.

### Type Inference Pattern (Standardized)

**All hooks use this consistent pattern for exporting nested types:**

```typescript
// ✅ Standard pattern - easy to read and understand
export type ValidationError = NonNullable<
    ReturnType<typeof useValidateAgent>['data']
>['errors'][number];

export type McpServer = NonNullable<
    ReturnType<typeof useServers>['data']
>[number];
```

**Why `NonNullable`?**
React Query hooks return `data: T | undefined` (undefined while loading). `NonNullable` removes `undefined` so we can safely access the array/object structure.

**Pattern breakdown:**
1. `ReturnType<typeof useHook>` - Get the hook's return type
2. `['data']` - Access the data property
3. `NonNullable<...>` - Remove undefined (assume data is loaded)
4. `[number]` - Get array element type (if it's an array)
5. `['field'][number]` - Access nested arrays (e.g., errors array)

**This pattern is used across all hooks for consistency and readability.**

## Migration Progress

### ✅ Completed
- [x] Fix core self-referencing import (api-key-resolver.ts)
- [x] Update server schema to use z.output types (mcp.ts - ServerInfoSchema)
- [x] Add proper JsonSchemaProperty schema with type/description/enum/default fields
- [x] Remove unused metadata field from core ToolResult
- [x] Migrate useServers hook - remove explicit types
- [x] Migrate useServerTools hook - remove explicit types
- [x] Update ServersPanel.tsx - remove 'unknown' status references
- [x] Clean up types.ts - remove McpServer, McpTool, ToolResult, etc (API response types)
- [x] Update all Playground components to use centralized type exports:
  - [x] PlaygroundView.tsx - import ToolResult from @dexto/core (domain type), import McpServer/McpTool from hooks
  - [x] ToolInputForm.tsx - use proper JsonSchemaProperty type, import McpTool from hooks
  - [x] ToolsList.tsx - import McpServer/McpTool from hooks (removed inline type definitions)
  - [x] ServersList.tsx - import McpServer from hooks (removed inline type definition)
  - [x] ToolResult.tsx - import ToolResult from @dexto/core, remove metadata references
- [x] Migrate useGreeting hook - replace apiFetch with typed client
- [x] Add typecheck script to webui package.json
- [x] Migrate useChat hook - complete streaming and sync message endpoints
  - [x] Replace EventStreamClient with createMessageStream from client-sdk
  - [x] Update processEvent to use MessageStreamEvent types directly
  - [x] Add approval:request and approval:response to StreamingEvent type in core
  - [x] Fix message-sync type inference issue (discriminated union) by checking response.ok
  - [x] Update server schema to use LLM_PROVIDERS and LLM_ROUTERS enums instead of z.string()
  - [x] Replace all payload references with event references in processEvent
  - [x] Remove apiUrl parameter from useChat signature
  - [x] Export createMessageStream and MessageStreamEvent from client-sdk index
- [x] Update ChatContext.tsx to remove apiUrl parameter when calling useChat
- [x] Migrate usePrompts hook - replace apiFetch with typed client
- [x] Migrate useResources hook - replace apiFetch with typed client, fix server ResourceSchema
- [x] Migrate useSessions hook (useDeleteSession) - replace apiFetch with typed client
- [x] Fix server ResourceSchema to include all fields from core ResourceMetadata (source, serverName, size, lastModified, metadata)
- [x] Migrate useAgentConfig hook - replace apiFetch with typed client (GET config, POST validate, POST save)
- [x] Migrate useResourceContent hook - replace apiFetch with typed client
- [x] Migrate useSearch hook - replace apiFetch with typed client (search messages and sessions)
- [x] Export nested types (ValidationError, ValidationWarning, SearchResult, SessionSearchResult) via type inference
- [x] Standardize type inference pattern across all hooks:
  - [x] Refactor complex Awaited<ReturnType<typeof client...>> patterns to simpler NonNullable<ReturnType<typeof useHook>['data']> pattern
  - [x] Add centralized type exports to useServers.ts (McpServer, McpTool)
  - [x] Remove 4+ duplicate inline type definitions from Playground components
  - [x] Document standardized pattern in plan.md with explanations

### 🚧 In Progress (Current Focus)
- [ ] Migrate remaining components that use fetch or apiFetch directly

### 📋 Remaining Hooks to Migrate
- [x] usePrompts.ts
- [x] useResources.ts
- [x] useSessions.ts
- [x] useAgentConfig.ts
- [x] useResourceContent.ts
- [x] useSearch.ts

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

**IMPORTANT**: Export `createMessageStream` from `@dexto/client-sdk` as it is currently missing from the main export but used in examples - DONE.

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

## Key Learnings

### Discriminated Union Type Inference with Hono Client

**Problem**: When a Hono route defines multiple response codes (e.g., 200 and 400), the Hono client returns a discriminated union type:

```typescript
const response = await client.api['message-sync'].$post({...});
// Type: ClientResponse<{}, 400, string> | ClientResponse<{...}, 200, "json">

const data = await response.json();
// Type: unknown ❌ - TypeScript can't infer which branch!
```

TypeScript cannot determine which response type you'll get at runtime, so `.json()` returns `unknown`.

**Solution**: Use `response.ok` as a type guard to narrow the discriminated union:

```typescript
const response = await client.api['message-sync'].$post({...});

if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
}

const data = await response.json();
// Type: { response: string; sessionId: string; ... } ✅ - Properly typed!
```

**Why This Works**:
- Checking `response.ok` narrows the type from a union to a single branch
- TypeScript knows that when `ok === true`, it must be the 200 response
- The `.json()` call can now infer the correct return type from the 200 response schema

**When You See This Pattern**:
- Any endpoint with multiple response codes will have this issue
- Routes with only a 200 response (like `greeting`) work without the check
- Always check `response.ok` before calling `.json()` on routes with multiple responses

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
