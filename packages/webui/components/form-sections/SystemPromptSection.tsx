'use client';

import React from 'react';
import { Textarea } from '../ui/textarea';
import { LabelWithTooltip } from '../ui/label-with-tooltip';
import { Collapsible } from '../ui/collapsible';

interface SystemPromptSectionProps {
  value: string;
  onChange: (value: string) => void;
  errors?: Record<string, string>;
}

export function SystemPromptSection({ value, onChange, errors = {} }: SystemPromptSectionProps) {
  return (
    <Collapsible title="System Prompt" defaultOpen={true}>
      <div className="space-y-2">
        <LabelWithTooltip htmlFor="systemPrompt" tooltip="Define how the agent should behave, what it can do, and any specific instructions">
          Instructions *
        </LabelWithTooltip>
        <Textarea
          id="systemPrompt"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter the system prompt that defines the agent's behavior and capabilities..."
          rows={12}
          className="font-mono text-sm"
        />
        {errors.systemPrompt && (
          <p className="text-xs text-destructive mt-1">{errors.systemPrompt}</p>
        )}
      </div>
    </Collapsible>
  );
}
