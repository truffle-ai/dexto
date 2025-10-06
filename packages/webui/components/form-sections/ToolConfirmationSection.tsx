'use client';

import React from 'react';
import { Input } from '../ui/input';
import { LabelWithTooltip } from '../ui/label-with-tooltip';
import { Collapsible } from '../ui/collapsible';
import type { AgentConfig } from '@dexto/core';

type ToolConfirmationConfig = NonNullable<AgentConfig['toolConfirmation']>;

interface ToolConfirmationSectionProps {
  value: ToolConfirmationConfig;
  onChange: (value: ToolConfirmationConfig) => void;
  errors?: Record<string, string>;
}

const CONFIRMATION_MODES = ['auto-approve', 'event-based', 'auto-deny'];
const STORAGE_TYPES = ['memory', 'storage'];

export function ToolConfirmationSection({
  value,
  onChange,
  errors = {},
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
    <Collapsible title="Tool Confirmation" defaultOpen={false}>
      <div className="space-y-4">
        {/* Confirmation Mode */}
        <div>
          <LabelWithTooltip htmlFor="confirmation-mode" tooltip="How the agent handles tool execution requests">
            Confirmation Mode
          </LabelWithTooltip>
          <select
            id="confirmation-mode"
            value={value.mode || 'auto-approve'}
            onChange={(e) => handleChange({ mode: e.target.value as 'auto-approve' | 'event-based' | 'auto-deny' })}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {CONFIRMATION_MODES.map((mode) => (
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
            />
            {errors.timeout && <p className="text-xs text-destructive mt-1">{errors.timeout}</p>}
          </div>
        )}

        {/* Allowed Tools Storage */}
        <div>
          <LabelWithTooltip htmlFor="allowed-tools-storage" tooltip="Where to store the list of pre-approved tools (memory or persistent storage)">
            Allowed Tools Storage
          </LabelWithTooltip>
          <select
            id="allowed-tools-storage"
            value={value.allowedToolsStorage || 'memory'}
            onChange={(e) => updateAllowedToolsStorage(e.target.value as 'memory' | 'storage')}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {STORAGE_TYPES.map((type) => (
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
