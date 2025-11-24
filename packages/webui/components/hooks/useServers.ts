import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { queryKeys } from '@/lib/queryKeys';
import type { McpServerConfig } from '@dexto/core';
import type { McpServer, McpTool } from '@/lib/api-types';

// Fetch all MCP servers
export function useServers(enabled: boolean = true) {
    return useQuery<McpServer[], Error>({
        queryKey: queryKeys.servers.all,
        queryFn: async () => {
            const res = await client.api.mcp.servers.$get();
            if (!res.ok) {
                throw new Error('Failed to fetch servers');
            }
            const data = await res.json();
            // Server response type matches McpServer[] exactly - no transformation needed
            return data.servers;
        },
        enabled,
    });
}

// Fetch tools for a specific server
export function useServerTools(serverId: string | null, enabled: boolean = true) {
    return useQuery<McpTool[], Error>({
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
            // Server response type matches McpTool[] exactly - no transformation needed
            return data.tools;
        },
        enabled: enabled && !!serverId,
    });
}

// Add new MCP server
export function useAddServer() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (payload: {
            name: string;
            config: Partial<McpServerConfig> & { type?: 'stdio' | 'sse' | 'http' };
            persistToAgent?: boolean;
        }) => {
            const res = await client.api.mcp.servers.$post({
                json: {
                    name: payload.name,
                    config: payload.config as McpServerConfig, // Cast to match expected type
                    persistToAgent: payload.persistToAgent,
                },
            });
            if (!res.ok) {
                const error = await res.text();
                throw new Error(error || 'Failed to add server');
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.servers.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all });
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
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.servers.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all });
        },
    });
}
