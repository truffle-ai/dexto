/**
 * FormEditorTabs - Clean tabbed form editor for agent configuration
 *
 * Design follows session/server panel patterns:
 * - Minimal borders, spacing-based hierarchy
 * - Section headers as uppercase labels
 * - shadcn Select components
 */

import React, { useState, useMemo } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
    Settings,
    Brain,
    Wrench,
    Eye,
    EyeOff,
    Plus,
    Trash2,
    Info,
    Loader2,
    ChevronRight,
    ChevronDown,
    Server,
} from 'lucide-react';
import type { AgentConfig, ToolFactoryEntry } from '@dexto/agent-config';
import type { ContributorConfig } from '@dexto/core';
import { LLM_PROVIDERS, MCP_SERVER_TYPES } from '@dexto/core';
import { cn } from '@/lib/utils';
import { useDiscovery } from '../hooks/useDiscovery';
import { useLLMCatalog, type LLMProvider } from '../hooks/useLLM';

// Providers that support custom baseURL
const BASE_URL_PROVIDERS = ['openai-compatible', 'litellm'];

interface FormEditorTabsProps {
    config: AgentConfig;
    onChange: (config: AgentConfig) => void;
    errors?: Record<string, string>;
}

type TabValue = 'model' | 'behavior' | 'tools';

export default function FormEditorTabs({ config, onChange, errors = {} }: FormEditorTabsProps) {
    const [activeTab, setActiveTab] = useState<TabValue>('model');

    // Count errors per tab
    const modelErrors = Object.keys(errors).filter(
        (k) => k.startsWith('llm.') || k === 'greeting'
    ).length;
    const behaviorErrors = Object.keys(errors).filter((k) => k.startsWith('systemPrompt')).length;
    const toolsErrors = Object.keys(errors).filter(
        (k) => k.startsWith('mcpServers') || k.startsWith('tools') || k.startsWith('permissions')
    ).length;

    return (
        <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as TabValue)}
            className="flex flex-col h-full"
        >
            <TabsList className="shrink-0">
                <TabsTrigger
                    value="model"
                    icon={<Settings className="h-3.5 w-3.5" />}
                    badge={modelErrors > 0 ? <ErrorBadge count={modelErrors} /> : undefined}
                >
                    Model
                </TabsTrigger>
                <TabsTrigger
                    value="behavior"
                    icon={<Brain className="h-3.5 w-3.5" />}
                    badge={behaviorErrors > 0 ? <ErrorBadge count={behaviorErrors} /> : undefined}
                >
                    Behavior
                </TabsTrigger>
                <TabsTrigger
                    value="tools"
                    icon={<Wrench className="h-3.5 w-3.5" />}
                    badge={toolsErrors > 0 ? <ErrorBadge count={toolsErrors} /> : undefined}
                >
                    Tools
                </TabsTrigger>
            </TabsList>

            <TabsContent value="model" className="flex-1 overflow-y-auto">
                <ModelTab config={config} onChange={onChange} errors={errors} />
            </TabsContent>

            <TabsContent value="behavior" className="flex-1 overflow-y-auto">
                <BehaviorTab config={config} onChange={onChange} errors={errors} />
            </TabsContent>

            <TabsContent value="tools" className="flex-1 overflow-y-auto">
                <ToolsTab config={config} onChange={onChange} errors={errors} />
            </TabsContent>
        </Tabs>
    );
}

function ErrorBadge({ count }: { count: number }) {
    return (
        <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 text-[10px] font-medium bg-destructive text-destructive-foreground rounded-full">
            {count}
        </span>
    );
}

// ============================================================================
// MODEL TAB - LLM Configuration
// ============================================================================

interface TabProps {
    config: AgentConfig;
    onChange: (config: AgentConfig) => void;
    errors: Record<string, string>;
}

type CatalogModelOption = {
    name: string;
    displayName?: string;
};

type BuiltinToolInfo = {
    name: string;
    description?: string;
};

type ToolFactoryInfo = {
    type: string;
    metadata?: {
        displayName?: string;
        description?: string;
    };
};

function ModelTab({ config, onChange, errors }: TabProps) {
    const [showApiKey, setShowApiKey] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);

    const currentProvider = config.llm?.provider || '';
    const { data: catalogData, isLoading: catalogLoading } = useLLMCatalog({
        mode: 'grouped',
        scope: 'all',
        provider: currentProvider ? (currentProvider as LLMProvider) : undefined,
        enabled: !!currentProvider,
    });
    const supportsBaseURL = BASE_URL_PROVIDERS.includes(currentProvider);

    const providerModels = useMemo(() => {
        if (!catalogData || !('providers' in catalogData) || !currentProvider) return [];
        const providerData =
            catalogData.providers[currentProvider as keyof typeof catalogData.providers];
        if (!providerData?.models) return [];
        return providerData.models.map((m: CatalogModelOption) => ({
            id: m.name,
            displayName: m.displayName || m.name,
        }));
    }, [catalogData, currentProvider]);

    const updateLLM = (updates: Partial<NonNullable<AgentConfig['llm']>>) => {
        onChange({
            ...config,
            llm: { ...config.llm, ...updates } as AgentConfig['llm'],
        });
    };

    return (
        <div className="p-5 space-y-8">
            {/* Language Model Section */}
            <Section title="Language Model">
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Provider" required error={errors['llm.provider']}>
                            <Select
                                value={currentProvider}
                                onValueChange={(value) => {
                                    updateLLM({
                                        provider: value as never,
                                        model: '', // Reset model when switching providers
                                        ...(value &&
                                            !BASE_URL_PROVIDERS.includes(value) && {
                                                baseURL: undefined,
                                            }),
                                    });
                                }}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select provider..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {LLM_PROVIDERS.map((p) => (
                                        <SelectItem key={p} value={p}>
                                            {p === 'dexto-nova'
                                                ? 'Dexto Nova'
                                                : p.charAt(0).toUpperCase() +
                                                  p.slice(1).replace(/-/g, ' ')}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Field>

                        <Field label="Model" required error={errors['llm.model']}>
                            {catalogLoading ? (
                                <div className="flex items-center h-9 px-3 text-sm text-muted-foreground border border-input rounded-md">
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    Loading...
                                </div>
                            ) : providerModels.length > 0 ? (
                                <Select
                                    value={config.llm?.model || ''}
                                    onValueChange={(value) => updateLLM({ model: value })}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Select model..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {providerModels.map(
                                            (m: { id: string; displayName: string }) => (
                                                <SelectItem key={m.id} value={m.id}>
                                                    {m.displayName}
                                                </SelectItem>
                                            )
                                        )}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <Input
                                    value={config.llm?.model || ''}
                                    onChange={(e) => updateLLM({ model: e.target.value })}
                                    placeholder={
                                        currentProvider
                                            ? 'Enter model name'
                                            : 'Select provider first'
                                    }
                                    aria-invalid={!!errors['llm.model']}
                                />
                            )}
                        </Field>
                    </div>

                    <Field label="API Key" hint="Use $ENV_VAR for environment variables">
                        <div className="relative">
                            <Input
                                type={showApiKey ? 'text' : 'password'}
                                value={config.llm?.apiKey ?? ''}
                                onChange={(e) => updateLLM({ apiKey: e.target.value })}
                                placeholder="$ANTHROPIC_API_KEY"
                                className="pr-10"
                            />
                            <button
                                type="button"
                                onClick={() => setShowApiKey(!showApiKey)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted/50 transition-colors"
                            >
                                {showApiKey ? (
                                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                    <Eye className="h-4 w-4 text-muted-foreground" />
                                )}
                            </button>
                        </div>
                    </Field>

                    {/* Base URL - Only for OpenAI-compatible providers */}
                    {supportsBaseURL && (
                        <Field
                            label="Base URL"
                            required
                            hint="Custom API endpoint for this provider"
                            error={errors['llm.baseURL']}
                        >
                            <Input
                                value={config.llm?.baseURL ?? ''}
                                onChange={(e) =>
                                    updateLLM({ baseURL: e.target.value || undefined })
                                }
                                placeholder="https://api.example.com/v1"
                            />
                        </Field>
                    )}

                    {/* Advanced Settings */}
                    <button
                        type="button"
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
                    >
                        {showAdvanced ? (
                            <ChevronDown className="h-4 w-4" />
                        ) : (
                            <ChevronRight className="h-4 w-4" />
                        )}
                        <span className="font-medium">Advanced Settings</span>
                    </button>

                    {showAdvanced && (
                        <div className="ml-6 space-y-4 pl-4 border-l-2 border-border/30">
                            <Field
                                label="Max Output Tokens"
                                hint="Maximum tokens for model responses"
                            >
                                <Input
                                    type="number"
                                    value={config.llm?.maxOutputTokens ?? ''}
                                    onChange={(e) =>
                                        updateLLM({
                                            maxOutputTokens: e.target.value
                                                ? parseInt(e.target.value, 10)
                                                : undefined,
                                        })
                                    }
                                    placeholder="4096"
                                    min="1"
                                />
                            </Field>
                        </div>
                    )}
                </div>
            </Section>

            {/* Greeting Section */}
            <Section title="Greeting">
                <Field hint="Initial message shown to users">
                    <Input
                        value={config.greeting || ''}
                        onChange={(e) => onChange({ ...config, greeting: e.target.value })}
                        placeholder="Hello! How can I help you today?"
                    />
                </Field>
            </Section>
        </div>
    );
}

// ============================================================================
// BEHAVIOR TAB - System Prompt
// ============================================================================

function BehaviorTab({ config, onChange, errors }: TabProps) {
    const getPromptContent = (): string => {
        if (!config.systemPrompt) return '';
        if (typeof config.systemPrompt === 'string') return config.systemPrompt;
        const primary = config.systemPrompt.contributors?.find((c) => c.type === 'static');
        return primary && 'content' in primary ? primary.content : '';
    };

    const updatePromptContent = (content: string) => {
        if (!config.systemPrompt || typeof config.systemPrompt === 'string') {
            onChange({
                ...config,
                systemPrompt: {
                    contributors: [
                        { id: 'primary', type: 'static', priority: 0, enabled: true, content },
                    ],
                },
            });
        } else {
            const contributors = [...(config.systemPrompt.contributors || [])];
            const primaryIdx = contributors.findIndex((c) => c.id === 'primary');
            if (primaryIdx >= 0) {
                contributors[primaryIdx] = {
                    ...contributors[primaryIdx],
                    content,
                } as ContributorConfig;
            } else {
                contributors.unshift({
                    id: 'primary',
                    type: 'static',
                    priority: 0,
                    enabled: true,
                    content,
                });
            }
            onChange({ ...config, systemPrompt: { contributors } });
        }
    };

    const hasMultipleContributors =
        config.systemPrompt &&
        typeof config.systemPrompt === 'object' &&
        config.systemPrompt.contributors &&
        config.systemPrompt.contributors.length > 1;

    return (
        <div className="p-5 h-full flex flex-col">
            <Section title="System Prompt" className="flex-1 flex flex-col">
                <Field error={errors.systemPrompt} className="flex-1 flex flex-col">
                    <Textarea
                        value={getPromptContent()}
                        onChange={(e) => updatePromptContent(e.target.value)}
                        placeholder="You are a helpful assistant..."
                        className="font-mono text-sm resize-none flex-1 min-h-[400px]"
                    />
                </Field>
                {hasMultipleContributors && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-3">
                        <Info className="h-3.5 w-3.5" />
                        This agent has multiple prompt contributors. Edit in YAML for full control.
                    </p>
                )}
            </Section>
        </div>
    );
}

// ============================================================================
// TOOLS TAB - Built-in Tools, Tool Factories, MCP Servers
// ============================================================================

function ToolsTab({ config, onChange, errors }: TabProps) {
    const { data: discovery, isLoading: discoveryLoading } = useDiscovery();
    const servers = Object.entries(config.mcpServers || {});

    const toolEntries: ToolFactoryEntry[] = config.tools ?? [];
    const builtinToolsEntry = toolEntries.find((t: ToolFactoryEntry) => t.type === 'builtin-tools');

    const enabledBuiltinTools = (() => {
        const enabledTools = builtinToolsEntry?.enabledTools;
        if (
            Array.isArray(enabledTools) &&
            enabledTools.every((toolName: string) => typeof toolName === 'string')
        ) {
            return enabledTools;
        }
        return discovery?.builtinTools?.map((tool: BuiltinToolInfo) => tool.name) ?? [];
    })();

    const toggleBuiltinTool = (toolName: string) => {
        const nextEnabledTools = enabledBuiltinTools.includes(toolName)
            ? enabledBuiltinTools.filter((t: string) => t !== toolName)
            : [...enabledBuiltinTools, toolName];

        const otherEntries = toolEntries.filter(
            (t: ToolFactoryEntry) => t.type !== 'builtin-tools'
        );
        const nextBuiltinToolsEntry = {
            ...(builtinToolsEntry ?? { type: 'builtin-tools' }),
            enabledTools: nextEnabledTools,
        };

        onChange({ ...config, tools: [...otherEntries, nextBuiltinToolsEntry] });
    };

    const enabledToolFactories = toolEntries
        .filter((t: ToolFactoryEntry) => t.type !== 'builtin-tools')
        .map((t: ToolFactoryEntry) => t.type);
    const toggleToolFactory = (toolType: string) => {
        const isEnabled = toolEntries.some((t: ToolFactoryEntry) => t.type === toolType);
        const nextTools = isEnabled
            ? toolEntries.filter((t: ToolFactoryEntry) => t.type !== toolType)
            : [...toolEntries, { type: toolType }];

        onChange({ ...config, tools: nextTools });
    };

    const toolPolicies = config.permissions?.toolPolicies || {
        alwaysAllow: [],
        alwaysDeny: [],
    };
    const alwaysAllowList = toolPolicies.alwaysAllow || [];

    const isToolAutoApproved = (qualifiedName: string) => alwaysAllowList.includes(qualifiedName);

    const toggleToolAutoApprove = (qualifiedName: string) => {
        const newAlwaysAllow = isToolAutoApproved(qualifiedName)
            ? alwaysAllowList.filter((t: string) => t !== qualifiedName)
            : [...alwaysAllowList, qualifiedName];

        onChange({
            ...config,
            permissions: {
                ...config.permissions,
                toolPolicies: {
                    ...toolPolicies,
                    alwaysAllow: newAlwaysAllow,
                },
            },
        });
    };

    const addServer = () => {
        const newName = `server-${servers.length + 1}`;
        onChange({
            ...config,
            mcpServers: {
                ...config.mcpServers,
                [newName]: { type: 'stdio', command: '', connectionMode: 'lenient' },
            },
        });
    };

    const removeServer = (name: string) => {
        const newServers = { ...config.mcpServers };
        delete newServers[name];
        onChange({ ...config, mcpServers: newServers });
    };

    const updateServer = (
        name: string,
        updates: Partial<NonNullable<AgentConfig['mcpServers']>[string]>
    ) => {
        const server = config.mcpServers?.[name];
        if (!server) return;
        onChange({
            ...config,
            mcpServers: {
                ...config.mcpServers,
                [name]: { ...server, ...updates } as NonNullable<AgentConfig['mcpServers']>[string],
            },
        });
    };

    const builtinTools = discovery?.builtinTools ?? [];
    const toolFactories = discovery?.toolFactories ?? [];
    const builtinToolsCount = builtinTools.length;
    const toolFactoriesCount = toolFactories.length;

    return (
        <div className="p-5 space-y-8">
            {/* Built-in Tools */}
            <Section title="Built-in Tools" description="Core built-in tools shipped with Dexto">
                {discoveryLoading ? (
                    <div className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading tools...
                    </div>
                ) : builtinToolsCount > 0 ? (
                    <div className="space-y-1">
                        {builtinTools.map((tool: BuiltinToolInfo) => {
                            const isEnabled = enabledBuiltinTools.includes(tool.name);
                            const qualifiedName = tool.name;
                            const isAutoApproved = isToolAutoApproved(qualifiedName);

                            return (
                                <ToolRow
                                    key={tool.name}
                                    name={tool.name}
                                    description={tool.description}
                                    isEnabled={isEnabled}
                                    isAutoApproved={isAutoApproved}
                                    showAutoApprove
                                    onToggleEnabled={() => toggleBuiltinTool(tool.name)}
                                    onToggleAutoApprove={() => toggleToolAutoApprove(qualifiedName)}
                                />
                            );
                        })}
                        <p className="text-xs text-muted-foreground/60 pt-3">
                            {enabledBuiltinTools.length} of {builtinToolsCount} enabled
                        </p>
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                        No built-in tools available
                    </p>
                )}
            </Section>

            {/* Tool Factories */}
            {toolFactoriesCount > 0 && (
                <Section title="Tool Factories" description="Additional tool packs from the image">
                    <div className="space-y-1">
                        {toolFactories.map((tool: ToolFactoryInfo) => {
                            const isEnabled = enabledToolFactories.includes(tool.type);
                            const displayName = tool.metadata?.displayName || tool.type;
                            const description = tool.metadata?.description;

                            return (
                                <ToolRow
                                    key={tool.type}
                                    name={displayName}
                                    description={description}
                                    isEnabled={isEnabled}
                                    isAutoApproved={false}
                                    showAutoApprove={false}
                                    onToggleEnabled={() => toggleToolFactory(tool.type)}
                                    onToggleAutoApprove={() => {}}
                                />
                            );
                        })}
                        <p className="text-xs text-muted-foreground/60 pt-3">
                            {enabledToolFactories.length} of {toolFactoriesCount} enabled
                        </p>
                    </div>
                </Section>
            )}

            {/* MCP Servers */}
            <Section title="MCP Servers" description="External tools via Model Context Protocol">
                {servers.length === 0 ? (
                    <div className="py-8 text-center">
                        <Server className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                        <p className="text-sm text-muted-foreground mb-4">No servers configured</p>
                        <Button onClick={addServer} variant="outline" size="sm">
                            <Plus className="h-4 w-4 mr-1.5" />
                            Add Server
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {servers.map(([name, server]) => (
                            <ServerCard
                                key={name}
                                name={name}
                                server={server}
                                onUpdate={(updates) => updateServer(name, updates)}
                                onRemove={() => removeServer(name)}
                                errors={errors}
                            />
                        ))}
                        <Button onClick={addServer} variant="outline" size="sm" className="w-full">
                            <Plus className="h-4 w-4 mr-1.5" />
                            Add Server
                        </Button>
                    </div>
                )}
            </Section>
        </div>
    );
}

function ToolRow({
    name,
    description,
    isEnabled,
    isAutoApproved,
    showAutoApprove,
    onToggleEnabled,
    onToggleAutoApprove,
}: {
    name: string;
    description?: string;
    isEnabled: boolean;
    isAutoApproved: boolean;
    showAutoApprove: boolean;
    onToggleEnabled: () => void;
    onToggleAutoApprove: () => void;
}) {
    return (
        <div
            className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                isEnabled ? 'bg-muted/40' : 'hover:bg-muted/20'
            )}
        >
            <input
                type="checkbox"
                checked={isEnabled}
                onChange={onToggleEnabled}
                className="h-4 w-4 rounded cursor-pointer shrink-0"
            />
            <div className="flex-1 min-w-0">
                <span className={cn('text-sm font-medium', !isEnabled && 'text-muted-foreground')}>
                    {name}
                </span>
                {description && (
                    <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
                        {description}
                    </p>
                )}
            </div>
            {isEnabled && showAutoApprove && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0 px-2 py-1 rounded hover:bg-muted/50 transition-colors">
                    <input
                        type="checkbox"
                        checked={isAutoApproved}
                        onChange={onToggleAutoApprove}
                        className="h-3 w-3 rounded"
                    />
                    <span>Auto-approve</span>
                </label>
            )}
        </div>
    );
}

function ServerCard({
    name,
    server,
    onUpdate,
    onRemove,
    errors,
}: {
    name: string;
    server: NonNullable<AgentConfig['mcpServers']>[string];
    onUpdate: (updates: Partial<NonNullable<AgentConfig['mcpServers']>[string]>) => void;
    onRemove: () => void;
    errors: Record<string, string>;
}) {
    const isStdio = server.type === 'stdio';

    return (
        <div className="group p-4 rounded-lg bg-muted/30 hover:bg-muted/40 transition-colors">
            <div className="flex items-start gap-3">
                <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-foreground">{name}</span>
                        <Select
                            value={server.type}
                            onValueChange={(type: 'stdio' | 'sse' | 'http') => {
                                if (type === 'stdio') {
                                    onUpdate({ type: 'stdio', command: '' } as never);
                                } else {
                                    onUpdate({ type, url: '' } as never);
                                }
                            }}
                        >
                            <SelectTrigger className="h-7 w-24 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {MCP_SERVER_TYPES.map((t) => (
                                    <SelectItem key={t} value={t}>
                                        {t.toUpperCase()}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {isStdio ? (
                        <Input
                            value={'command' in server ? server.command : ''}
                            onChange={(e) => onUpdate({ command: e.target.value } as never)}
                            placeholder="npx -y @modelcontextprotocol/server-filesystem"
                            className="text-sm font-mono"
                            aria-invalid={!!errors[`mcpServers.${name}.command`]}
                        />
                    ) : (
                        <Input
                            value={'url' in server ? server.url : ''}
                            onChange={(e) => onUpdate({ url: e.target.value } as never)}
                            placeholder="https://mcp.example.com/sse"
                            className="text-sm"
                            aria-invalid={!!errors[`mcpServers.${name}.url`]}
                        />
                    )}
                </div>

                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onRemove}
                    className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                    <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
            </div>
        </div>
    );
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

function Section({
    title,
    description,
    className,
    children,
}: {
    title: string;
    description?: string;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div className={cn('rounded-xl bg-muted/20 p-5', className)}>
            <div className="mb-4">
                <h3 className="text-xs font-semibold text-muted-foreground/80 uppercase tracking-wider">
                    {title}
                </h3>
                {description && (
                    <p className="text-xs text-muted-foreground/60 mt-0.5">{description}</p>
                )}
            </div>
            {children}
        </div>
    );
}

function Field({
    label,
    required,
    hint,
    error,
    className,
    children,
}: {
    label?: string;
    required?: boolean;
    hint?: string;
    error?: string;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div className={className}>
            {label && (
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    {label}
                    {required && <span className="text-destructive ml-0.5">*</span>}
                </label>
            )}
            {children}
            {hint && !error && (
                <p className="text-[11px] text-muted-foreground/60 mt-1.5">{hint}</p>
            )}
            {error && <p className="text-xs text-destructive mt-1.5">{error}</p>}
        </div>
    );
}
