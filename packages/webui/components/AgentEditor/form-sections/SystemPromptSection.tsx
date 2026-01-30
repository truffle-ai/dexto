import React, { useState } from 'react';
import { Input } from '../../ui/input';
import { Textarea } from '../../ui/textarea';
import { LabelWithTooltip } from '../../ui/label-with-tooltip';
import { Button } from '../../ui/button';
import { Collapsible } from '../../ui/collapsible';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { PROMPT_GENERATOR_SOURCES } from '@dexto/core';
import type { ContributorConfig } from '@dexto/core';

// Component works with the object form of SystemPromptConfig (not the string form)
type SystemPromptConfigObject = {
    contributors: ContributorConfig[];
};

interface SystemPromptSectionProps {
    value: SystemPromptConfigObject;
    onChange: (value: SystemPromptConfigObject) => void;
    errors?: Record<string, string>;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    errorCount?: number;
    sectionErrors?: string[];
}

export function SystemPromptSection({
    value,
    onChange,
    errors = {},
    open,
    onOpenChange,
    errorCount = 0,
    sectionErrors = [],
}: SystemPromptSectionProps) {
    const [expandedContributors, setExpandedContributors] = useState<Set<string>>(new Set());
    // Local state for file paths (comma-separated editing)
    const [editingFiles, setEditingFiles] = useState<Record<string, string>>({});

    const contributors = value.contributors || [];

    const toggleContributor = (id: string) => {
        setExpandedContributors((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const addContributor = () => {
        const newId = `contributor-${Date.now()}`;
        const newContributor: ContributorConfig = {
            id: newId,
            type: 'static',
            priority: contributors.length * 10,
            enabled: true,
            content: '',
        };
        onChange({
            contributors: [...contributors, newContributor],
        });
        setExpandedContributors((prev) => new Set(prev).add(newId));
    };

    const removeContributor = (id: string) => {
        onChange({
            contributors: contributors.filter((c) => c.id !== id),
        });
        setExpandedContributors((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    };

    const updateContributor = (id: string, updates: Partial<ContributorConfig>) => {
        onChange({
            contributors: contributors.map((c) => {
                if (c.id === id) {
                    // If ID is changing, handle the ID change
                    if (updates.id && updates.id !== id) {
                        // Update expanded state
                        setExpandedContributors((prev) => {
                            const next = new Set(prev);
                            if (next.has(id)) {
                                next.delete(id);
                                next.add(updates.id!);
                            }
                            return next;
                        });
                    }

                    // If type is changing, create a new contributor with the new type
                    if (updates.type && updates.type !== c.type) {
                        const baseFields = {
                            id: updates.id || c.id,
                            priority:
                                updates.priority !== undefined ? updates.priority : c.priority,
                            enabled: updates.enabled !== undefined ? updates.enabled : c.enabled,
                        };

                        if (updates.type === 'static') {
                            return {
                                ...baseFields,
                                type: 'static',
                                content: '',
                            } as ContributorConfig;
                        } else if (updates.type === 'dynamic') {
                            return {
                                ...baseFields,
                                type: 'dynamic',
                                source: 'date',
                            } as ContributorConfig;
                        } else if (updates.type === 'file') {
                            return { ...baseFields, type: 'file', files: [] } as ContributorConfig;
                        }
                    }

                    return { ...c, ...updates } as ContributorConfig;
                }
                return c;
            }),
        });
    };

    // Get the current value for file paths (either from editing state or from config)
    const getFilesValue = (id: string, files: string[]): string => {
        return editingFiles[id] ?? files.join(', ');
    };

    // Update local editing state while typing
    const setFilesValue = (id: string, value: string) => {
        setEditingFiles((prev) => ({ ...prev, [id]: value }));
    };

    // Parse and commit files on blur
    const commitFiles = (id: string, filesString: string) => {
        setEditingFiles((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
        });

        const files = filesString
            .split(',')
            .map((f) => f.trim())
            .filter(Boolean);

        updateContributor(id, { files: files.length > 0 ? files : [] });
    };

    return (
        <Collapsible
            title="System Prompt"
            defaultOpen={true}
            open={open}
            onOpenChange={onOpenChange}
            errorCount={errorCount}
            sectionErrors={sectionErrors}
        >
            <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    Define how the agent should behave using multiple contributors with different
                    priorities.
                </p>

                {contributors.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No contributors configured</p>
                ) : (
                    contributors.map((contributor) => {
                        const isExpanded = expandedContributors.has(contributor.id);
                        return (
                            <div
                                key={contributor.id}
                                className="border border-border rounded-lg overflow-hidden"
                            >
                                {/* Contributor Header */}
                                <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
                                    <button
                                        onClick={() => toggleContributor(contributor.id)}
                                        className="flex items-center gap-2 flex-1 text-left hover:text-foreground transition-colors"
                                    >
                                        {isExpanded ? (
                                            <ChevronUp className="h-4 w-4" />
                                        ) : (
                                            <ChevronDown className="h-4 w-4" />
                                        )}
                                        <span className="font-medium text-sm">
                                            {contributor.id}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            ({contributor.type}, priority: {contributor.priority})
                                        </span>
                                        {contributor.enabled === false && (
                                            <span className="text-xs text-destructive">
                                                (disabled)
                                            </span>
                                        )}
                                    </button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeContributor(contributor.id)}
                                        className="h-7 w-7 p-0"
                                    >
                                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                    </Button>
                                </div>

                                {/* Contributor Details */}
                                {isExpanded && (
                                    <div className="px-3 py-3 space-y-3">
                                        {/* Common Fields */}
                                        <div>
                                            <LabelWithTooltip
                                                htmlFor={`contributor-id-${contributor.id}`}
                                                tooltip="Unique identifier for this contributor"
                                            >
                                                ID *
                                            </LabelWithTooltip>
                                            <Input
                                                id={`contributor-id-${contributor.id}`}
                                                value={contributor.id}
                                                onChange={(e) =>
                                                    updateContributor(contributor.id, {
                                                        id: e.target.value,
                                                    })
                                                }
                                                placeholder="e.g., primary, date"
                                            />
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <LabelWithTooltip
                                                    htmlFor={`contributor-type-${contributor.id}`}
                                                    tooltip="Type of contributor: static (fixed text), dynamic (runtime generated), or file (from files)"
                                                >
                                                    Type *
                                                </LabelWithTooltip>
                                                <select
                                                    id={`contributor-type-${contributor.id}`}
                                                    value={contributor.type}
                                                    onChange={(e) =>
                                                        updateContributor(contributor.id, {
                                                            type: e.target.value as
                                                                | 'static'
                                                                | 'dynamic'
                                                                | 'file',
                                                        })
                                                    }
                                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                                >
                                                    <option value="static">Static</option>
                                                    <option value="dynamic">Dynamic</option>
                                                    <option value="file">File</option>
                                                </select>
                                            </div>

                                            <div>
                                                <LabelWithTooltip
                                                    htmlFor={`contributor-priority-${contributor.id}`}
                                                    tooltip="Execution priority (lower numbers run first)"
                                                >
                                                    Priority *
                                                </LabelWithTooltip>
                                                <Input
                                                    id={`contributor-priority-${contributor.id}`}
                                                    type="number"
                                                    value={contributor.priority}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        const num = Number.parseInt(val, 10);
                                                        updateContributor(contributor.id, {
                                                            priority: Number.isNaN(num) ? 0 : num,
                                                        });
                                                    }}
                                                    placeholder="0"
                                                    min="0"
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="flex items-center gap-2 text-sm">
                                                <input
                                                    type="checkbox"
                                                    checked={contributor.enabled !== false}
                                                    onChange={(e) =>
                                                        updateContributor(contributor.id, {
                                                            enabled: e.target.checked,
                                                        })
                                                    }
                                                    className="rounded border-input"
                                                />
                                                <span>Enabled</span>
                                            </label>
                                        </div>

                                        {/* Type-specific Fields */}
                                        {contributor.type === 'static' && (
                                            <div>
                                                <LabelWithTooltip
                                                    htmlFor={`contributor-content-${contributor.id}`}
                                                    tooltip="Static content for the system prompt"
                                                >
                                                    Content *
                                                </LabelWithTooltip>
                                                <Textarea
                                                    id={`contributor-content-${contributor.id}`}
                                                    value={contributor.content}
                                                    onChange={(e) =>
                                                        updateContributor(contributor.id, {
                                                            content: e.target.value,
                                                        })
                                                    }
                                                    placeholder="You are a helpful assistant..."
                                                    rows={8}
                                                    className="font-mono text-sm"
                                                />
                                            </div>
                                        )}

                                        {contributor.type === 'dynamic' && (
                                            <div>
                                                <LabelWithTooltip
                                                    htmlFor={`contributor-source-${contributor.id}`}
                                                    tooltip="Source for dynamic content generation"
                                                >
                                                    Source *
                                                </LabelWithTooltip>
                                                <select
                                                    id={`contributor-source-${contributor.id}`}
                                                    value={contributor.source}
                                                    onChange={(e) =>
                                                        updateContributor(contributor.id, {
                                                            source: e.target.value as Extract<
                                                                ContributorConfig,
                                                                { type: 'dynamic' }
                                                            >['source'],
                                                        })
                                                    }
                                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                                >
                                                    {PROMPT_GENERATOR_SOURCES.map((source) => (
                                                        <option key={source} value={source}>
                                                            {source}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {contributor.type === 'file' && (
                                            <>
                                                <div>
                                                    <LabelWithTooltip
                                                        htmlFor={`contributor-files-${contributor.id}`}
                                                        tooltip="File paths to include, comma-separated"
                                                    >
                                                        Files *
                                                    </LabelWithTooltip>
                                                    <Input
                                                        id={`contributor-files-${contributor.id}`}
                                                        value={getFilesValue(
                                                            contributor.id,
                                                            contributor.files
                                                        )}
                                                        onChange={(e) =>
                                                            setFilesValue(
                                                                contributor.id,
                                                                e.target.value
                                                            )
                                                        }
                                                        onBlur={(e) =>
                                                            commitFiles(
                                                                contributor.id,
                                                                e.target.value
                                                            )
                                                        }
                                                        placeholder="./commands/context.md, ./commands/rules.txt"
                                                        className="font-mono"
                                                    />
                                                </div>

                                                {/* File Options */}
                                                <details className="border border-border rounded-md p-2">
                                                    <summary className="text-sm font-medium cursor-pointer">
                                                        File Options
                                                    </summary>
                                                    <div className="mt-3 space-y-3">
                                                        <label className="flex items-center gap-2 text-sm">
                                                            <input
                                                                type="checkbox"
                                                                checked={
                                                                    contributor.options
                                                                        ?.includeFilenames !== false
                                                                }
                                                                onChange={(e) =>
                                                                    updateContributor(
                                                                        contributor.id,
                                                                        {
                                                                            options: {
                                                                                ...(contributor.options ??
                                                                                    {}),
                                                                                includeFilenames:
                                                                                    e.target
                                                                                        .checked,
                                                                            },
                                                                        }
                                                                    )
                                                                }
                                                                className="rounded border-input"
                                                            />
                                                            <span>
                                                                Include filenames as headers
                                                            </span>
                                                        </label>

                                                        <label className="flex items-center gap-2 text-sm">
                                                            <input
                                                                type="checkbox"
                                                                checked={
                                                                    contributor.options
                                                                        ?.includeMetadata === true
                                                                }
                                                                onChange={(e) =>
                                                                    updateContributor(
                                                                        contributor.id,
                                                                        {
                                                                            options: {
                                                                                ...(contributor.options ??
                                                                                    {}),
                                                                                includeMetadata:
                                                                                    e.target
                                                                                        .checked,
                                                                            },
                                                                        }
                                                                    )
                                                                }
                                                                className="rounded border-input"
                                                            />
                                                            <span>Include file metadata</span>
                                                        </label>

                                                        <div>
                                                            <LabelWithTooltip
                                                                htmlFor={`contributor-separator-${contributor.id}`}
                                                                tooltip="Separator between multiple files"
                                                            >
                                                                Separator
                                                            </LabelWithTooltip>
                                                            <Input
                                                                id={`contributor-separator-${contributor.id}`}
                                                                value={
                                                                    contributor.options
                                                                        ?.separator ?? '\n\n---\n\n'
                                                                }
                                                                onChange={(e) =>
                                                                    updateContributor(
                                                                        contributor.id,
                                                                        {
                                                                            options: {
                                                                                ...(contributor.options ??
                                                                                    {}),
                                                                                separator:
                                                                                    e.target.value,
                                                                            },
                                                                        }
                                                                    )
                                                                }
                                                                placeholder="\n\n---\n\n"
                                                            />
                                                        </div>

                                                        <div>
                                                            <LabelWithTooltip
                                                                htmlFor={`contributor-error-handling-${contributor.id}`}
                                                                tooltip="How to handle missing or unreadable files"
                                                            >
                                                                Error Handling
                                                            </LabelWithTooltip>
                                                            <select
                                                                id={`contributor-error-handling-${contributor.id}`}
                                                                value={
                                                                    contributor.options
                                                                        ?.errorHandling || 'skip'
                                                                }
                                                                onChange={(e) =>
                                                                    updateContributor(
                                                                        contributor.id,
                                                                        {
                                                                            options: {
                                                                                ...(contributor.options ??
                                                                                    {}),
                                                                                errorHandling: e
                                                                                    .target
                                                                                    .value as
                                                                                    | 'skip'
                                                                                    | 'error',
                                                                            },
                                                                        }
                                                                    )
                                                                }
                                                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                                            >
                                                                <option value="skip">
                                                                    Skip missing files
                                                                </option>
                                                                <option value="error">
                                                                    Error on missing files
                                                                </option>
                                                            </select>
                                                        </div>

                                                        <div>
                                                            <LabelWithTooltip
                                                                htmlFor={`contributor-max-file-size-${contributor.id}`}
                                                                tooltip="Maximum file size in bytes"
                                                            >
                                                                Max File Size (bytes)
                                                            </LabelWithTooltip>
                                                            <Input
                                                                id={`contributor-max-file-size-${contributor.id}`}
                                                                type="number"
                                                                value={
                                                                    contributor.options
                                                                        ?.maxFileSize || 100000
                                                                }
                                                                onChange={(e) => {
                                                                    const val = e.target.value;
                                                                    const num = Number.parseInt(
                                                                        val,
                                                                        10
                                                                    );
                                                                    updateContributor(
                                                                        contributor.id,
                                                                        {
                                                                            options: {
                                                                                ...(contributor.options ??
                                                                                    {}),
                                                                                maxFileSize:
                                                                                    Number.isNaN(
                                                                                        num
                                                                                    )
                                                                                        ? undefined
                                                                                        : num,
                                                                            },
                                                                        }
                                                                    );
                                                                }}
                                                                placeholder="100000"
                                                                min="1"
                                                            />
                                                        </div>
                                                    </div>
                                                </details>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}

                {/* Add Contributor Button */}
                <Button onClick={addContributor} variant="outline" size="sm" className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Contributor
                </Button>

                {errors.systemPrompt && (
                    <p className="text-xs text-destructive mt-1">{errors.systemPrompt}</p>
                )}
            </div>
        </Collapsible>
    );
}
