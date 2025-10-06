'use client';

import React from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
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
          <Label htmlFor="confirmation-mode">Confirmation Mode</Label>
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
            <Label htmlFor="confirmation-timeout">Timeout (seconds)</Label>
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
            <p className="text-xs text-muted-foreground mt-1">
              How long to wait for approval before timing out
            </p>
            {errors.timeout && <p className="text-xs text-destructive mt-1">{errors.timeout}</p>}
          </div>
        )}

        {/* Allowed Tools Storage */}
        <div>
          <Label htmlFor="allowed-tools-storage">Allowed Tools Storage</Label>
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
          <p className="text-xs text-muted-foreground mt-1">
            Where to store the list of pre-approved tools
          </p>
        </div>
      </div>
    </Collapsible>
  );
}
