'use client';

import React from 'react';
import { Input } from '../ui/input';
import { LabelWithTooltip } from '../ui/label-with-tooltip';
import { Collapsible } from '../ui/collapsible';
import { LLM_PROVIDERS, LLM_ROUTERS, type AgentConfig } from '@dexto/core';

type LLMConfig = AgentConfig['llm'];

interface LLMConfigSectionProps {
  value: LLMConfig;
  onChange: (value: LLMConfig) => void;
  errors?: Record<string, string>;
}

export function LLMConfigSection({ value, onChange, errors = {} }: LLMConfigSectionProps) {
  const handleChange = (field: keyof LLMConfig, newValue: string | number | undefined) => {
    onChange({ ...value, [field]: newValue } as LLMConfig);
  };

  return (
    <Collapsible title="LLM Configuration" defaultOpen={true}>
      <div className="space-y-4">
        {/* Provider */}
        <div>
          <LabelWithTooltip htmlFor="provider" tooltip="The LLM provider to use (e.g., OpenAI, Anthropic)">
            Provider *
          </LabelWithTooltip>
          <select
            id="provider"
            value={value.provider}
            onChange={(e) => handleChange('provider', e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">Select provider...</option>
            {LLM_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {errors.provider && <p className="text-xs text-destructive mt-1">{errors.provider}</p>}
        </div>

        {/* Model */}
        <div>
          <LabelWithTooltip htmlFor="model" tooltip="The specific model identifier (e.g., gpt-4, claude-3-opus)">
            Model *
          </LabelWithTooltip>
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
          <LabelWithTooltip htmlFor="apiKey" tooltip="Use $ENV_VAR for environment variables or enter the API key directly">
            API Key *
          </LabelWithTooltip>
          <Input
            id="apiKey"
            type="password"
            value={value.apiKey}
            onChange={(e) => handleChange('apiKey', e.target.value)}
            placeholder="$OPENAI_API_KEY or direct value"
          />
          {errors.apiKey && <p className="text-xs text-destructive mt-1">{errors.apiKey}</p>}
        </div>

        {/* Router */}
        <div>
          <LabelWithTooltip htmlFor="router" tooltip="LLM routing backend: 'vercel' uses Vercel AI SDK, 'in-built' uses provider-specific clients">
            Router
          </LabelWithTooltip>
          <select
            id="router"
            value={value.router || 'vercel'}
            onChange={(e) => handleChange('router', e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {LLM_ROUTERS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        {/* Max Iterations */}
        <div>
          <LabelWithTooltip htmlFor="maxIterations" tooltip="Maximum number of agent reasoning iterations per turn">
            Max Iterations
          </LabelWithTooltip>
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
          <LabelWithTooltip htmlFor="baseURL" tooltip="Custom base URL for the LLM provider (optional, for proxies or custom endpoints)">
            Base URL
          </LabelWithTooltip>
          <Input
            id="baseURL"
            value={value.baseURL || ''}
            onChange={(e) => handleChange('baseURL', e.target.value || undefined)}
            placeholder="https://api.openai.com/v1"
          />
        </div>

        {/* Temperature */}
        <div>
          <LabelWithTooltip htmlFor="temperature" tooltip="Controls randomness in responses (0.0 = deterministic, 1.0 = creative)">
            Temperature
          </LabelWithTooltip>
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
            <LabelWithTooltip htmlFor="maxInputTokens" tooltip="Maximum input tokens to send to the model">
              Max Input Tokens
            </LabelWithTooltip>
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
            <LabelWithTooltip htmlFor="maxOutputTokens" tooltip="Maximum output tokens the model can generate">
              Max Output Tokens
            </LabelWithTooltip>
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
