# WebUI Development Guidelines for AI Agents

Comprehensive guide for AI agents working on the Dexto Vite WebUI.

## Core Philosophy

**Server Schemas = Single Source of Truth**

Server defines all API types using Zod schemas → Hono typed client extracts types → React Query infers automatically → Components get full type safety.

**NO Type Casting. NO `any` Types. NO Explicit Type Parameters.**

If you need to cast, it's a RED FLAG. Fix the server schema instead.

## Architecture

**Stack**: Vite + React 19 + TypeScript + TanStack Router + Hono Typed Client + TanStack Query + SSE

**Key Files**:
- `lib/client.ts` - Hono client initialization
- `lib/queryKeys.ts` - React Query key factory
- `components/hooks/` - All API hooks
- `types.ts` - UI-specific types only (NOT API types)

## Type Flow

```
Server Zod Schemas → Hono Routes → Typed Client → React Query → Components
```

All automatic. No manual type definitions.

## React Query Hook Patterns

### Query Hook (Standard Pattern)

```typescript
// components/hooks/useServers.ts
import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { queryKeys } from '@/lib/queryKeys';

// No explicit types! Let TypeScript infer.
export function useServers(enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.servers.all,
        queryFn: async () => {
            const res = await client.api.mcp.servers.$get();
            if (!res.ok) throw new Error('Failed to fetch servers');
            const data = await res.json();
            return data.servers; // Type inferred from server schema
        },
        enabled,
    });
}

// Export types using standard inference pattern
export type McpServer = NonNullable<ReturnType<typeof useServers>['data']>[number];
```

**Type Inference Pattern Breakdown**:
- `ReturnType<typeof useHook>` - Hook's return type (UseQueryResult)
- `['data']` - Data property
- `NonNullable<...>` - Remove undefined (assumes loaded)
- `[number]` - Array element type (if array)
- `['field'][number]` - Nested array access

### Mutation Hook (Standard Pattern)

```typescript
export function useCreateMemory() {
    const queryClient = useQueryClient();

    return useMutation({
        // Simple payload: inline type
        mutationFn: async (payload: {
            content: string;
            tags?: string[];
        }) => {
            const response = await client.api.memory.$post({ json: payload });
            return await response.json();
        },
        // Always invalidate affected queries
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.memories.all });
        },
    });
}

// Complex payload: use Parameters utility
export function useSwitchAgent() {
    return useMutation({
        mutationFn: async (
            payload: Parameters<typeof client.api.agents.switch.$post>[0]['json']
        ) => {
            const response = await client.api.agents.switch.$post({ json: payload });
            return await response.json();
        },
    });
}
```

### Handling Multiple Response Codes

Always check `response.ok` to narrow discriminated unions:

```typescript
const response = await client.api['message-sync'].$post({...});

if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
}

const data = await response.json(); // Now properly typed!
```

### SSE Streaming

```typescript
import { createMessageStream } from '@dexto/client-sdk';
import type { MessageStreamEvent } from '@dexto/client-sdk';

const responsePromise = client.api['message-stream'].$post({ json: { message, sessionId } });
const iterator = createMessageStream(responsePromise, { signal: abortController.signal });

for await (const event of iterator) {
    processEvent(event); // Fully typed as MessageStreamEvent
}
```

## Component Patterns

### Importing and Using Hooks

```typescript
// ✅ Import types from hooks (centralized)
import { useServers } from '@/hooks/useServers';
import type { McpServer } from '@/hooks/useServers';

export function ServersList() {
    const { data: servers, isLoading } = useServers();
    const deleteServer = useDeleteServer();

    if (isLoading) return <LoadingSpinner />;
    if (!servers) return <EmptyState />;

    return (
        <div>
            {servers.map((server) => ( // server is fully typed
                <ServerCard
                    key={server.id}
                    server={server}
                    onDelete={() => deleteServer.mutate(server.id)}
                />
            ))}
        </div>
    );
}
```

### Mutation Success/Error Handling

```typescript
const createMemory = useCreateMemory();

const handleSubmit = () => {
    createMemory.mutate(
        { content, tags },
        {
            onSuccess: (data) => {
                toast.success('Memory created');
                onClose();
            },
            onError: (error: Error) => {
                setError(error.message);
            },
        }
    );
};
```

### Mutations in useCallback/useMemo Dependencies

**CRITICAL:** useMutation objects are NOT stable and will cause infinite re-renders if added to dependency arrays. Instead, extract `mutate` or `mutateAsync` functions which ARE stable:

```typescript
// ❌ WRONG - mutation object is unstable
const addServerMutation = useAddServer();

const handleClick = useCallback(() => {
    addServerMutation.mutate({ name, config });
}, [addServerMutation]); // ⚠️ Causes infinite loop!

// ✅ CORRECT - extract stable function
const { mutate: addServer } = useAddServer();

const handleClick = useCallback(() => {
    addServer({ name, config });
}, [addServer]); // ✅ Safe - mutate function is stable

// ✅ CORRECT - for async operations
const { mutateAsync: addServer } = useAddServer();

const handleClick = useCallback(async () => {
    await addServer({ name, config });
    doSomethingElse();
}, [addServer]); // ✅ Safe - mutateAsync function is stable
```

**Reference:** See `ApprovalRequestHandler.tsx` for the pattern in action.

## State Management

- **TanStack Query** - Server state, caching, API data
- **React Context** - App-wide UI state (theme, active session)
- **Zustand** - Persistent UI state (localStorage)

## Common Patterns

### Conditional Queries

```typescript
export function useServerTools(serverId: string | null, enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.servers.tools(serverId || ''),
        queryFn: async () => {
            if (!serverId) return [];
            // ... fetch tools
        },
        enabled: enabled && !!serverId, // Only run if both true
    });
}
```

### Parameterized Hooks

```typescript
export function useLLMCatalog(options?: { enabled?: boolean; mode?: 'grouped' | 'flat' }) {
    const mode = options?.mode ?? 'grouped';
    return useQuery({
        queryKey: [...queryKeys.llm.catalog, mode],
        queryFn: async () => {
            const response = await client.api.llm.catalog.$get({ query: { mode } });
            return await response.json();
        },
        enabled: options?.enabled ?? true,
    });
}
```

## What NOT to Do

### ❌ Don't Add Explicit Types

```typescript
// ❌ WRONG
export function useServers() {
    return useQuery<McpServer[], Error>({ ... });
}

// ✅ CORRECT
export function useServers() {
    return useQuery({ ... }); // TypeScript infers
}
```

### ❌ Don't Cast API Response Types

```typescript
// ❌ WRONG - RED FLAG!
const servers = data.servers as McpServer[];
config: payload.config as McpServerConfig;

// ✅ CORRECT - Fix server schema
```

### ❌ Don't Duplicate Types

```typescript
// ❌ WRONG - in types.ts
export interface McpServer { id: string; name: string; }

// ✅ CORRECT - export from hook
export type McpServer = NonNullable<ReturnType<typeof useServers>['data']>[number];
```

### ❌ Don't Create Inline Types

```typescript
// ❌ WRONG
function ServerCard({ server }: { server: { id: string; name: string } }) {}

// ✅ CORRECT
import type { McpServer } from '@/hooks/useServers';
function ServerCard({ server }: { server: McpServer }) {}
```

### ❌ Don't Skip Cache Invalidation

```typescript
// ❌ WRONG
export function useDeleteServer() {
    return useMutation({
        mutationFn: async (serverId: string) => { ... },
        // Missing onSuccess!
    });
}

// ✅ CORRECT
export function useDeleteServer() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (serverId: string) => { ... },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.servers.all });
        },
    });
}
```

## Migration Checklist

When adding a new API endpoint:

1. Define Zod schema in server route
2. Use `z.output<typeof Schema>` for inline server types
3. Create hook in `components/hooks/` (no explicit types)
4. Export inferred types using `NonNullable<ReturnType<...>>` pattern
5. Add query key to `queryKeys.ts`
6. Handle cache invalidation in mutations
7. Import types from hook in components
8. Verify no type casts needed

## Key Files Reference

- **Server Routes**: `packages/server/src/hono/routes/`
- **Client SDK**: `packages/client-sdk/src/`
- **Core Types**: `packages/core/src/`
- **Query Keys**: `packages/webui/lib/queryKeys.ts`

## Summary

1. **Server schemas = source of truth** - Never duplicate types
2. **Let TypeScript infer everything** - No explicit type parameters
3. **Export types from hooks** - Centralized and consistent
4. **Type casting = red flag** - Fix at source
5. **Always invalidate cache** - Keep UI in sync

**If you're fighting with types, you're doing it wrong. Fix the server schema.**
