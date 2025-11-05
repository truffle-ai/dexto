import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client.js';
import { queryKeys } from '@/lib/queryKeys.js';
import type { McpServer, McpTool } from '@/types';
import type { McpServerConfig } from '@dexto/core';

// Fetch all MCP servers
export function useServers(enabled: boolean = true) {
    return useQuery<McpServer[], Error>({
        queryKey: queryKeys.servers.all,
        queryFn: async () => {
            const data = await apiFetch<{ servers: McpServer[] }>('/api/mcp/servers');
            return data.servers || [];
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
            const data = await apiFetch<{ tools: McpTool[] }>(`/api/mcp/servers/${serverId}/tools`);
            return data.tools || [];
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
            await apiFetch('/api/mcp/servers', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
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
            await apiFetch(`/api/mcp/servers/${serverId}`, { method: 'DELETE' });
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
            await apiFetch(`/api/mcp/servers/${serverId}/restart`, { method: 'POST' });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.servers.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all });
        },
    });
}
