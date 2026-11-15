import React from 'react';
import { Input } from '../../ui/input';
import { LabelWithTooltip } from '../../ui/label-with-tooltip';
import { Collapsible } from '../../ui/collapsible';
import type { AgentConfig } from '@dexto/agent-config';
import {
    PERMISSIONS_MODES,
    PERMISSIONS_MODE_LABELS,
    ALLOWED_TOOLS_STORAGE_TYPES,
    DEFAULT_PERMISSIONS_MODE,
    DEFAULT_ALLOWED_TOOLS_STORAGE,
    resolvePermissionsMode,
} from '@dexto/core';

type PermissionsConfig = NonNullable<AgentConfig['permissions']>;

interface PermissionsSectionProps {
    value: PermissionsConfig;
    onChange: (value: PermissionsConfig) => void;
    errors?: Record<string, string>;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    errorCount?: number;
    sectionErrors?: string[];
}

export function PermissionsSection({
    value,
    onChange,
    errors = {},
    open,
    onOpenChange,
    errorCount = 0,
    sectionErrors = [],
}: PermissionsSectionProps) {
    const handleChange = (updates: Partial<PermissionsConfig>) => {
        onChange({ ...value, ...updates });
    };

    // Deprecated values (manual, auto-approve) display as the mode they map to.
    const mode = resolvePermissionsMode(value.mode ?? DEFAULT_PERMISSIONS_MODE);

    const updateAllowedToolsStorage = (type: 'memory' | 'storage') => {
        onChange({
            ...value,
            allowedToolsStorage: type,
        });
    };

    return (
        <Collapsible
            title="Permissions"
            defaultOpen={false}
            open={open}
            onOpenChange={onOpenChange}
            errorCount={errorCount}
            sectionErrors={sectionErrors}
        >
            <div className="space-y-4">
                {/* Confirmation Mode */}
                <div>
                    <LabelWithTooltip
                        htmlFor="confirmation-mode"
                        tooltip="How the agent handles tool execution requests"
                    >
                        Mode
                    </LabelWithTooltip>
                    <select
                        id="confirmation-mode"
                        value={mode}
                        onChange={(e) => {
                            const selected = PERMISSIONS_MODES.find(
                                (option) => option === e.target.value
                            );
                            if (selected !== undefined) {
                                handleChange({ mode: selected });
                            }
                        }}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                        {PERMISSIONS_MODES.map((option) => (
                            <option key={option} value={option}>
                                {PERMISSIONS_MODE_LABELS[option]}
                            </option>
                        ))}
                    </select>
                    <p className="text-xs text-muted-foreground mt-1">
                        {mode === 'asks-you'
                            ? 'Asks you before file edits, shell commands and other approval-sensitive tools'
                            : 'Runs tools without asking'}
                    </p>
                </div>

                {/* Timeout */}
                {mode === 'asks-you' && (
                    <div>
                        <LabelWithTooltip
                            htmlFor="confirmation-timeout"
                            tooltip="How long to wait for approval before timing out"
                        >
                            Timeout (seconds)
                        </LabelWithTooltip>
                        <Input
                            id="confirmation-timeout"
                            type="number"
                            value={value.timeout || ''}
                            onChange={(e) =>
                                handleChange({
                                    timeout: e.target.value
                                        ? parseInt(e.target.value, 10)
                                        : undefined,
                                })
                            }
                            min="1"
                            placeholder="e.g., 60"
                            aria-invalid={!!errors['permissions.timeout']}
                        />
                        {errors['permissions.timeout'] && (
                            <p className="text-xs text-destructive mt-1">
                                {errors['permissions.timeout']}
                            </p>
                        )}
                    </div>
                )}

                {/* Allowed Tools Storage */}
                <div>
                    <LabelWithTooltip
                        htmlFor="allowed-tools-storage"
                        tooltip="Where to store the list of pre-approved tools (memory or persistent storage)"
                    >
                        Allowed Tools Storage
                    </LabelWithTooltip>
                    <select
                        id="allowed-tools-storage"
                        value={value.allowedToolsStorage || DEFAULT_ALLOWED_TOOLS_STORAGE}
                        onChange={(e) =>
                            updateAllowedToolsStorage(e.target.value as 'memory' | 'storage')
                        }
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                        {ALLOWED_TOOLS_STORAGE_TYPES.map((type) => (
                            <option key={type} value={type}>
                                {type}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
        </Collapsible>
    );
}
