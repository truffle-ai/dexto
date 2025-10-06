'use client';

import React, { useState } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Collapsible } from '../ui/collapsible';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

import type { AgentConfig } from '@dexto/core';

type McpServersConfig = NonNullable<AgentConfig['mcpServers']>;

interface McpServersSectionProps {
  value: McpServersConfig;
  onChange: (value: McpServersConfig) => void;
  errors?: Record<string, string>;
}

export function McpServersSection({ value, onChange, errors = {} }: McpServersSectionProps) {
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());

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

  const updateServer = (oldName: string, updates: Partial<Record<string, unknown>> & { name?: string }) => {
    const server = value[oldName];

    // Extract name from updates if present (it's not part of the server config, just used for the key)
    const { name: newName, ...serverUpdates } = updates;
    const newServer = { ...server, ...serverUpdates } as McpServersConfig[string];

    // If name changed via updates, handle the name change
    if (newName && newName !== oldName) {
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

  const updateArgs = (serverName: string, argsString: string) => {
    const args = argsString
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    updateServer(serverName, { args });
  };

  const updateEnv = (serverName: string, envString: string) => {
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
    updateServer(serverName, { env });
  };

  return (
    <Collapsible title="MCP Servers" defaultOpen={false}>
      <div className="space-y-4">
        {servers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No MCP servers configured</p>
        ) : (
          servers.map(([name, server]) => {
            const isExpanded = expandedServers.has(name);
            return (
              <div key={name} className="border border-border rounded-lg overflow-hidden">
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
                      <Label htmlFor={`server-name-${name}`}>Server Name</Label>
                      <Input
                        id={`server-name-${name}`}
                        value={name}
                        onChange={(e) => updateServer(name, { name: e.target.value })}
                        placeholder="e.g., filesystem"
                      />
                    </div>

                    {/* Command - only for stdio type */}
                    {'command' in server && (
                      <div>
                        <Label htmlFor={`server-command-${name}`}>Command *</Label>
                        <Input
                          id={`server-command-${name}`}
                          value={server.command}
                          onChange={(e) => updateServer(name, { command: e.target.value })}
                          placeholder="e.g., npx, node, python"
                        />
                      </div>
                    )}

                    {/* Connection Mode */}
                    <div>
                      <Label htmlFor={`server-mode-${name}`}>Connection Mode</Label>
                      <select
                        id={`server-mode-${name}`}
                        value={server.connectionMode || 'strict'}
                        onChange={(e) =>
                          updateServer(name, { connectionMode: e.target.value as 'strict' | 'lenient' })
                        }
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <option value="strict">Strict</option>
                        <option value="lenient">Lenient</option>
                      </select>
                    </div>

                    {/* Arguments - only for stdio type */}
                    {'args' in server && (
                      <div>
                        <Label htmlFor={`server-args-${name}`}>Arguments (one per line)</Label>
                        <textarea
                          id={`server-args-${name}`}
                          value={(server.args || []).join('\n')}
                          onChange={(e) => updateArgs(name, e.target.value)}
                          placeholder="--port 3000\n--host localhost"
                          rows={4}
                          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                        />
                      </div>
                    )}

                    {/* Environment Variables - only for stdio type */}
                    {'env' in server && (
                      <div>
                        <Label htmlFor={`server-env-${name}`}>
                          Environment Variables (KEY=value, one per line)
                        </Label>
                        <textarea
                          id={`server-env-${name}`}
                          value={Object.entries(server.env || {})
                            .map(([k, v]) => `${k}=${v}`)
                            .join('\n')}
                          onChange={(e) => updateEnv(name, e.target.value)}
                          placeholder="API_KEY=$MY_API_KEY\nPORT=3000"
                          rows={4}
                          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                        />
                      </div>
                    )}
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
