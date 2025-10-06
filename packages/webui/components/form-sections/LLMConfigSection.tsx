'use client';

import React from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Collapsible } from '../ui/collapsible';
import type { AgentConfig } from '@dexto/core';

type LLMConfig = AgentConfig['llm'];

interface LLMConfigSectionProps {
  value: LLMConfig;
  onChange: (value: LLMConfig) => void;
  errors?: Record<string, string>;
}

const PROVIDERS = ['openai', 'anthropic', 'google', 'groq', 'together', 'azure', 'bedrock', 'ollama'];
const ROUTERS = ['vercel', 'in-built'];

export function LLMConfigSection({ value, onChange, errors = {} }: LLMConfigSectionProps) {
  const handleChange = (field: keyof LLMConfig, newValue: string | number | undefined) => {
    onChange({ ...value, [field]: newValue } as LLMConfig);
  };

  return (
    <Collapsible title="LLM Configuration" defaultOpen={true}>
      <div className="space-y-4">
        {/* Provider */}
        <div>
          <Label htmlFor="provider">Provider *</Label>
          <select
            id="provider"
            value={value.provider}
            onChange={(e) => handleChange('provider', e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">Select provider...</option>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {errors.provider && <p className="text-xs text-destructive mt-1">{errors.provider}</p>}
        </div>

        {/* Model */}
        <div>
          <Label htmlFor="model">Model *</Label>
          <Input
            id="model"
            value={value.model}
            onChange={(e) => handleChange('model', e.target.value)}
            placeholder="e.g., gpt-4, claude-3-opus-20240229"
          />
          {errors.model && <p className="text-xs text-destructive mt-1">{errors.model}</p>}
        </div>

        {/* API Key */}
        <div>
          <Label htmlFor="apiKey">API Key *</Label>
          <Input
            id="apiKey"
            type="password"
            value={value.apiKey}
            onChange={(e) => handleChange('apiKey', e.target.value)}
            placeholder="$OPENAI_API_KEY or direct value"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Use $ENV_VAR for environment variables or enter directly
          </p>
          {errors.apiKey && <p className="text-xs text-destructive mt-1">{errors.apiKey}</p>}
        </div>

        {/* Router */}
        <div>
          <Label htmlFor="router">Router</Label>
          <select
            id="router"
            value={value.router || 'vercel'}
            onChange={(e) => handleChange('router', e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {ROUTERS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        {/* Max Iterations */}
        <div>
          <Label htmlFor="maxIterations">Max Iterations</Label>
          <Input
            id="maxIterations"
            type="number"
            value={value.maxIterations || 50}
            onChange={(e) => handleChange('maxIterations', parseInt(e.target.value, 10))}
            min="1"
          />
        </div>

        {/* Base URL */}
        <div>
          <Label htmlFor="baseURL">Base URL (optional)</Label>
          <Input
            id="baseURL"
            value={value.baseURL || ''}
            onChange={(e) => handleChange('baseURL', e.target.value || undefined)}
            placeholder="https://api.openai.com/v1"
          />
        </div>

        {/* Temperature */}
        <div>
          <Label htmlFor="temperature">Temperature</Label>
          <Input
            id="temperature"
            type="number"
            value={value.temperature !== undefined ? value.temperature : ''}
            onChange={(e) =>
              handleChange('temperature', e.target.value ? parseFloat(e.target.value) : undefined)
            }
            min="0"
            max="1"
            step="0.1"
            placeholder="0.0 - 1.0"
          />
        </div>

        {/* Max Input/Output Tokens */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="maxInputTokens">Max Input Tokens</Label>
            <Input
              id="maxInputTokens"
              type="number"
              value={value.maxInputTokens || ''}
              onChange={(e) =>
                handleChange('maxInputTokens', e.target.value ? parseInt(e.target.value, 10) : undefined)
              }
              min="1"
              placeholder="Optional"
            />
          </div>
          <div>
            <Label htmlFor="maxOutputTokens">Max Output Tokens</Label>
            <Input
              id="maxOutputTokens"
              type="number"
              value={value.maxOutputTokens || ''}
              onChange={(e) =>
                handleChange('maxOutputTokens', e.target.value ? parseInt(e.target.value, 10) : undefined)
              }
              min="1"
              placeholder="Optional"
            />
          </div>
        </div>
      </div>
    </Collapsible>
  );
}
