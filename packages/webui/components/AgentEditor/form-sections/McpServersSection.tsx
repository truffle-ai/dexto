import React, { useState } from 'react';
import { Input } from '../../ui/input';
import { LabelWithTooltip } from '../../ui/label-with-tooltip';
import { Button } from '../../ui/button';
import { Collapsible } from '../../ui/collapsible';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

import type { AgentConfig } from '@dexto/agent-config';
import { MCP_SERVER_TYPES, MCP_CONNECTION_MODES, DEFAULT_MCP_CONNECTION_MODE } from '@dexto/core';

type McpServersConfig = NonNullable<AgentConfig['mcpServers']>;

interface McpServersSectionProps {
    value: McpServersConfig;
    onChange: (value: McpServersConfig) => void;
    errors?: Record<string, string>;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    errorCount?: number;
    sectionErrors?: string[];
}

export function McpServersSection({
    value,
    onChange,
    errors = {},
    open,
    onOpenChange,
    errorCount = 0,
    sectionErrors = [],
}: McpServersSectionProps) {
    const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
    // Local state for text fields that need special parsing (args, env, headers)
    // Key is "serverName:fieldName", value is the raw string being edited
    const [editingFields, setEditingFields] = useState<Record<string, string>>({});

    const servers = Object.entries(value || {});

    const toggleServer = (name: string) => {
        setExpandedServers((prev) => {
            const next = new Set(prev);
            if (next.has(name)) {
                next.delete(name);
            } else {
                next.add(name);
            }
            return next;
        });
    };

    const addServer = () => {
        const newName = `server-${Object.keys(value || {}).length + 1}`;
        onChange({
            ...value,
            [newName]: {
                type: 'stdio',
                command: '',
                connectionMode: 'strict',
            },
        });
        setExpandedServers((prev) => new Set(prev).add(newName));
    };

    const removeServer = (name: string) => {
        const newValue = { ...value };
        delete newValue[name];
        onChange(newValue);
        setExpandedServers((prev) => {
            const next = new Set(prev);
            next.delete(name);
            return next;
        });
    };

    const updateServer = (
        oldName: string,
        updates: Partial<Record<string, unknown> & { name?: string }>
    ) => {
        const server = value[oldName];

        // Extract name from updates if present (it's not part of the server config, just used for the key)
        const { name: newName, ...serverUpdates } = updates;
        const newServer = { ...server, ...serverUpdates } as McpServersConfig[string];

        // If name changed via updates, handle the name change
        if (newName && typeof newName === 'string' && newName !== oldName) {
            // Guard against collision: prevent overwriting an existing server
            if (value[newName]) {
                // TODO: Surface a user-facing error via onChange/errors map or toast notification
                return; // No-op to avoid overwriting an existing server
            }
            const newValue = { ...value };
            delete newValue[oldName];
            newValue[newName] = newServer;
            onChange(newValue);

            // Update expanded state
            setExpandedServers((prev) => {
                const next = new Set(prev);
                if (next.has(oldName)) {
                    next.delete(oldName);
                    next.add(newName);
                }
                return next;
            });
        } else {
            onChange({ ...value, [oldName]: newServer });
        }
    };

    // Get the current value for a field (either from editing state or from config)
    const getFieldValue = (serverName: string, fieldName: string, fallback: string): string => {
        const key = `${serverName}:${fieldName}`;
        return editingFields[key] ?? fallback;
    };

    // Update local editing state while typing
    const setFieldValue = (serverName: string, fieldName: string, value: string) => {
        const key = `${serverName}:${fieldName}`;
        setEditingFields((prev) => ({ ...prev, [key]: value }));
    };

    // Clear editing state for a field
    const clearFieldValue = (serverName: string, fieldName: string) => {
        const key = `${serverName}:${fieldName}`;
        setEditingFields((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
    };

    // Parse and commit args on blur
    const commitArgs = (serverName: string, argsString: string) => {
        clearFieldValue(serverName, 'args');

        if (!argsString.trim()) {
            updateServer(serverName, { args: undefined });
            return;
        }

        const args = argsString
            .split(',')
            .map((arg) => arg.trim())
            .filter(Boolean);

        updateServer(serverName, { args: args.length > 0 ? args : undefined });
    };

    // Parse and commit env on blur
    const commitEnv = (serverName: string, envString: string) => {
        clearFieldValue(serverName, 'env');

        if (!envString.trim()) {
            updateServer(serverName, { env: undefined });
            return;
        }

        const env: Record<string, string> = {};
        envString
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .forEach((line) => {
                const [key, ...valueParts] = line.split('=');
                if (key && valueParts.length > 0) {
                    env[key.trim()] = valueParts.join('=').trim();
                }
            });
        updateServer(serverName, { env: Object.keys(env).length > 0 ? env : undefined });
    };

    // Parse and commit headers on blur
    const commitHeaders = (serverName: string, headersString: string) => {
        clearFieldValue(serverName, 'headers');

        if (!headersString.trim()) {
            updateServer(serverName, { headers: undefined });
            return;
        }

        const headers: Record<string, string> = {};
        headersString
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .forEach((line) => {
                const [key, ...valueParts] = line.split('=');
                if (key && valueParts.length > 0) {
                    headers[key.trim()] = valueParts.join('=').trim();
                }
            });
        updateServer(serverName, {
            headers: Object.keys(headers).length > 0 ? headers : undefined,
        });
    };

    return (
        <Collapsible
            title="MCP Servers"
            defaultOpen={false}
            open={open}
            onOpenChange={onOpenChange}
            errorCount={errorCount}
            sectionErrors={sectionErrors}
        >
            <div className="space-y-4">
                {servers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No MCP servers configured</p>
                ) : (
                    servers.map(([name, server]) => {
                        const isExpanded = expandedServers.has(name);
                        return (
                            <div
                                key={name}
                                className="border border-border rounded-lg overflow-hidden"
                            >
                                {/* Server Header */}
                                <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
                                    <button
                                        onClick={() => toggleServer(name)}
                                        className="flex items-center gap-2 flex-1 text-left hover:text-foreground transition-colors"
                                    >
                                        {isExpanded ? (
                                            <ChevronUp className="h-4 w-4" />
                                        ) : (
                                            <ChevronDown className="h-4 w-4" />
                                        )}
                                        <span className="font-medium text-sm">{name}</span>
                                        {'command' in server && server.command && (
                                            <span className="text-xs text-muted-foreground truncate">
                                                ({server.command})
                                            </span>
                                        )}
                                    </button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeServer(name)}
                                        className="h-7 w-7 p-0"
                                    >
                                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                    </Button>
                                </div>

                                {/* Server Details */}
                                {isExpanded && (
                                    <div className="px-3 py-3 space-y-3">
                                        {/* Server Name */}
                                        <div>
                                            <LabelWithTooltip
                                                htmlFor={`server-name-${name}`}
                                                tooltip="Unique identifier for this MCP server"
                                            >
                                                Server Name
                                            </LabelWithTooltip>
                                            <Input
                                                id={`server-name-${name}`}
                                                value={name}
                                                onChange={(e) =>
                                                    updateServer(name, { name: e.target.value })
                                                }
                                                placeholder="e.g., filesystem"
                                            />
                                        </div>

                                        {/* Server Type */}
                                        <div>
                                            <LabelWithTooltip
                                                htmlFor={`server-type-${name}`}
                                                tooltip="MCP server connection type"
                                            >
                                                Connection Type *
                                            </LabelWithTooltip>
                                            <select
                                                id={`server-type-${name}`}
                                                value={server.type || 'stdio'}
                                                onChange={(e) => {
                                                    const type = e.target.value as
                                                        | 'stdio'
                                                        | 'sse'
                                                        | 'http';
                                                    if (type === 'stdio') {
                                                        updateServer(name, {
                                                            type: 'stdio',
                                                            command: '',
                                                            args: undefined,
                                                            env: undefined,
                                                        });
                                                    } else {
                                                        updateServer(name, {
                                                            type,
                                                            url: '',
                                                            headers: undefined,
                                                        });
                                                    }
                                                }}
                                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                            >
                                                {MCP_SERVER_TYPES.map((type) => (
                                                    <option key={type} value={type}>
                                                        {type === 'stdio'
                                                            ? 'Standard I/O (stdio)'
                                                            : type === 'sse'
                                                              ? 'Server-Sent Events (SSE)'
                                                              : 'HTTP'}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* stdio-specific fields */}
                                        {server.type === 'stdio' && (
                                            <>
                                                {/* Command */}
                                                <div>
                                                    <LabelWithTooltip
                                                        htmlFor={`server-command-${name}`}
                                                        tooltip="The command to execute (e.g., npx, node, python)"
                                                    >
                                                        Command *
                                                    </LabelWithTooltip>
                                                    <Input
                                                        id={`server-command-${name}`}
                                                        value={
                                                            'command' in server
                                                                ? server.command
                                                                : ''
                                                        }
                                                        onChange={(e) =>
                                                            updateServer(name, {
                                                                command: e.target.value,
                                                            })
                                                        }
                                                        placeholder="e.g., npx, node, python"
                                                        aria-invalid={
                                                            !!errors[`mcpServers.${name}.command`]
                                                        }
                                                    />
                                                    {errors[`mcpServers.${name}.command`] && (
                                                        <p className="text-xs text-destructive mt-1">
                                                            {errors[`mcpServers.${name}.command`]}
                                                        </p>
                                                    )}
                                                </div>

                                                {/* Arguments */}
                                                <div>
                                                    <LabelWithTooltip
                                                        htmlFor={`server-args-${name}`}
                                                        tooltip="Command arguments, comma-separated"
                                                    >
                                                        Arguments
                                                    </LabelWithTooltip>
                                                    <Input
                                                        id={`server-args-${name}`}
                                                        value={getFieldValue(
                                                            name,
                                                            'args',
                                                            ('args' in server && server.args
                                                                ? server.args
                                                                : []
                                                            ).join(', ')
                                                        )}
                                                        onChange={(e) =>
                                                            setFieldValue(
                                                                name,
                                                                'args',
                                                                e.target.value
                                                            )
                                                        }
                                                        onBlur={(e) =>
                                                            commitArgs(name, e.target.value)
                                                        }
                                                        placeholder="--port, 3000, --host, localhost"
                                                        className="font-mono"
                                                    />
                                                </div>

                                                {/* Environment Variables */}
                                                <div>
                                                    <LabelWithTooltip
                                                        htmlFor={`server-env-${name}`}
                                                        tooltip="Environment variables in KEY=value format, one per line"
                                                    >
                                                        Environment Variables
                                                    </LabelWithTooltip>
                                                    <textarea
                                                        id={`server-env-${name}`}
                                                        value={getFieldValue(
                                                            name,
                                                            'env',
                                                            Object.entries(
                                                                ('env' in server && server.env) ||
                                                                    {}
                                                            )
                                                                .map(([k, v]) => `${k}=${v}`)
                                                                .join('\n')
                                                        )}
                                                        onChange={(e) =>
                                                            setFieldValue(
                                                                name,
                                                                'env',
                                                                e.target.value
                                                            )
                                                        }
                                                        onBlur={(e) =>
                                                            commitEnv(name, e.target.value)
                                                        }
                                                        placeholder={`API_KEY=$MY_API_KEY\nPORT=3000`}
                                                        rows={4}
                                                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                                                    />
                                                </div>
                                            </>
                                        )}

                                        {/* sse/http-specific fields */}
                                        {(server.type === 'sse' || server.type === 'http') && (
                                            <>
                                                {/* URL */}
                                                <div>
                                                    <LabelWithTooltip
                                                        htmlFor={`server-url-${name}`}
                                                        tooltip="The URL endpoint for the MCP server"
                                                    >
                                                        URL *
                                                    </LabelWithTooltip>
                                                    <Input
                                                        id={`server-url-${name}`}
                                                        value={'url' in server ? server.url : ''}
                                                        onChange={(e) =>
                                                            updateServer(name, {
                                                                url: e.target.value,
                                                            })
                                                        }
                                                        placeholder="https://example.com/mcp"
                                                        aria-invalid={
                                                            !!errors[`mcpServers.${name}.url`]
                                                        }
                                                    />
                                                    {errors[`mcpServers.${name}.url`] && (
                                                        <p className="text-xs text-destructive mt-1">
                                                            {errors[`mcpServers.${name}.url`]}
                                                        </p>
                                                    )}
                                                </div>

                                                {/* Headers */}
                                                <div>
                                                    <LabelWithTooltip
                                                        htmlFor={`server-headers-${name}`}
                                                        tooltip="HTTP headers in KEY=value format, one per line"
                                                    >
                                                        Headers
                                                    </LabelWithTooltip>
                                                    <textarea
                                                        id={`server-headers-${name}`}
                                                        value={getFieldValue(
                                                            name,
                                                            'headers',
                                                            Object.entries(
                                                                ('headers' in server &&
                                                                    server.headers) ||
                                                                    {}
                                                            )
                                                                .map(([k, v]) => `${k}=${v}`)
                                                                .join('\n')
                                                        )}
                                                        onChange={(e) =>
                                                            setFieldValue(
                                                                name,
                                                                'headers',
                                                                e.target.value
                                                            )
                                                        }
                                                        onBlur={(e) =>
                                                            commitHeaders(name, e.target.value)
                                                        }
                                                        placeholder={`Authorization=Bearer token\nContent-Type=application/json`}
                                                        rows={4}
                                                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                                                    />
                                                </div>
                                            </>
                                        )}

                                        {/* Connection Mode */}
                                        <div>
                                            <LabelWithTooltip
                                                htmlFor={`server-mode-${name}`}
                                                tooltip="Strict mode fails on any error; lenient mode continues despite errors"
                                            >
                                                Connection Mode
                                            </LabelWithTooltip>
                                            <select
                                                id={`server-mode-${name}`}
                                                value={
                                                    server.connectionMode ||
                                                    DEFAULT_MCP_CONNECTION_MODE
                                                }
                                                onChange={(e) =>
                                                    updateServer(name, {
                                                        connectionMode: e.target.value as
                                                            | 'strict'
                                                            | 'lenient',
                                                    })
                                                }
                                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                            >
                                                {MCP_CONNECTION_MODES.map((mode) => (
                                                    <option key={mode} value={mode}>
                                                        {mode.charAt(0).toUpperCase() +
                                                            mode.slice(1)}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}

                {/* Add Server Button */}
                <Button onClick={addServer} variant="outline" size="sm" className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    Add MCP Server
                </Button>

                {errors.mcpServers && (
                    <p className="text-xs text-destructive mt-1">{errors.mcpServers}</p>
                )}
            </div>
        </Collapsible>
    );
}
