'use client';

import React from 'react';
import { Input } from '../../ui/input';
import { LabelWithTooltip } from '../../ui/label-with-tooltip';
import { Collapsible } from '../../ui/collapsible';
import type { AgentConfig } from '@dexto/core';
import {
  TOOL_CONFIRMATION_MODES,
  ALLOWED_TOOLS_STORAGE_TYPES,
  DEFAULT_TOOL_CONFIRMATION_MODE,
  DEFAULT_ALLOWED_TOOLS_STORAGE,
} from '@dexto/core';

type ToolConfirmationConfig = NonNullable<AgentConfig['toolConfirmation']>;

interface ToolConfirmationSectionProps {
  value: ToolConfirmationConfig;
  onChange: (value: ToolConfirmationConfig) => void;
  errors?: Record<string, string>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  errorCount?: number;
  sectionErrors?: string[];
}

export function ToolConfirmationSection({
  value,
  onChange,
  errors = {},
  open,
  onOpenChange,
  errorCount = 0,
  sectionErrors = [],
}: ToolConfirmationSectionProps) {
  const handleChange = (updates: Partial<ToolConfirmationConfig>) => {
    onChange({ ...value, ...updates });
  };

  const updateAllowedToolsStorage = (type: 'memory' | 'storage') => {
    onChange({
      ...value,
      allowedToolsStorage: type,
    });
  };

  return (
    <Collapsible
      title="Tool Confirmation"
      defaultOpen={false}
      open={open}
      onOpenChange={onOpenChange}
      errorCount={errorCount}
      sectionErrors={sectionErrors}
    >
      <div className="space-y-4">
        {/* Confirmation Mode */}
        <div>
          <LabelWithTooltip htmlFor="confirmation-mode" tooltip="How the agent handles tool execution requests">
            Confirmation Mode
          </LabelWithTooltip>
          <select
            id="confirmation-mode"
            value={value.mode || DEFAULT_TOOL_CONFIRMATION_MODE}
            onChange={(e) => handleChange({ mode: e.target.value as 'auto-approve' | 'event-based' | 'auto-deny' })}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {TOOL_CONFIRMATION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode === 'auto-approve'
                  ? 'Auto-approve'
                  : mode === 'event-based'
                    ? 'Event-based'
                    : 'Auto-deny'}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            {value.mode === 'event-based'
              ? 'Require explicit approval before executing tools'
              : value.mode === 'auto-deny'
                ? 'Automatically deny all tool executions'
                : 'Automatically approve tool executions'}
          </p>
        </div>

        {/* Timeout */}
        {value.mode === 'event-based' && (
          <div>
            <LabelWithTooltip htmlFor="confirmation-timeout" tooltip="How long to wait for approval before timing out">
              Timeout (seconds)
            </LabelWithTooltip>
            <Input
              id="confirmation-timeout"
              type="number"
              value={value.timeout || ''}
              onChange={(e) =>
                handleChange({ timeout: e.target.value ? parseInt(e.target.value, 10) : undefined })
              }
              min="1"
              placeholder="e.g., 60"
              aria-invalid={!!errors['toolConfirmation.timeout']}
            />
            {errors['toolConfirmation.timeout'] && <p className="text-xs text-destructive mt-1">{errors['toolConfirmation.timeout']}</p>}
          </div>
        )}

        {/* Allowed Tools Storage */}
        <div>
          <LabelWithTooltip htmlFor="allowed-tools-storage" tooltip="Where to store the list of pre-approved tools (memory or persistent storage)">
            Allowed Tools Storage
          </LabelWithTooltip>
          <select
            id="allowed-tools-storage"
            value={value.allowedToolsStorage || DEFAULT_ALLOWED_TOOLS_STORAGE}
            onChange={(e) => updateAllowedToolsStorage(e.target.value as 'memory' | 'storage')}
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
