import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { queryKeys } from '@/lib/queryKeys';

export function useServers(enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.servers.all,
        queryFn: async () => {
            const res = await client.api.mcp.servers.$get();
            if (!res.ok) {
                throw new Error('Failed to fetch servers');
            }
            const data = await res.json();
            // Type is inferred from Hono client response schema
            return data.servers;
        },
        enabled,
        staleTime: 30 * 1000, // 30 seconds - server status can change
    });
}

export function useServerTools(serverId: string | null, enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.servers.tools(serverId || ''),
        queryFn: async () => {
            if (!serverId) return [];
            const res = await client.api.mcp.servers[':serverId'].tools.$get({
                param: { serverId },
            });
            if (!res.ok) {
                throw new Error('Failed to fetch tools');
            }
            const data = await res.json();
            // Type is inferred from Hono client response schema
            return data.tools;
        },
        enabled: enabled && !!serverId,
        staleTime: 2 * 60 * 1000, // 2 minutes - tools don't change once server is connected
    });
}

// Add new MCP server
export function useAddServer() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (payload: Parameters<typeof client.api.mcp.servers.$post>[0]['json']) => {
            const res = await client.api.mcp.servers.$post({ json: payload });
            if (!res.ok) {
                const error = await res.text();
                throw new Error(error || 'Failed to add server');
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.servers.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.resources.all });
        },
    });
}

// Delete MCP server
export function useDeleteServer() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (serverId: string) => {
            const res = await client.api.mcp.servers[':serverId'].$delete({
                param: { serverId },
            });
            if (!res.ok) {
                throw new Error('Failed to delete server');
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.servers.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.resources.all });
        },
    });
}

// Restart MCP server
export function useRestartServer() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (serverId: string) => {
            const res = await client.api.mcp.servers[':serverId'].restart.$post({
                param: { serverId },
            });
            if (!res.ok) {
                throw new Error('Failed to restart server');
            }
            return serverId;
        },
        onSuccess: (serverId) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.servers.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.resources.all });
            // Invalidate tools for this server as they may have changed after restart
            queryClient.invalidateQueries({ queryKey: queryKeys.servers.tools(serverId) });
        },
    });
}

// Export types inferred from hook return values
export type McpServer = NonNullable<ReturnType<typeof useServers>['data']>[number];
export type McpTool = NonNullable<ReturnType<typeof useServerTools>['data']>[number];
