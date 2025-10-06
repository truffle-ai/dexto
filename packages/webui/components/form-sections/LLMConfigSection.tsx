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
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  errorCount?: number;
  sectionErrors?: string[];
}

export function LLMConfigSection({
  value,
  onChange,
  errors = {},
  open,
  onOpenChange,
  errorCount = 0,
  sectionErrors = [],
}: LLMConfigSectionProps) {
  const handleChange = (field: keyof LLMConfig, newValue: string | number | undefined) => {
    onChange({ ...value, [field]: newValue } as LLMConfig);
  };

  return (
    <Collapsible
      title="LLM Configuration"
      defaultOpen={true}
      open={open}
      onOpenChange={onOpenChange}
      errorCount={errorCount}
    >
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
            aria-invalid={!!errors['llm.provider']}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive"
          >
            <option value="">Select provider...</option>
            {LLM_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {errors['llm.provider'] && <p className="text-xs text-destructive mt-1">{errors['llm.provider']}</p>}
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
            aria-invalid={!!errors['llm.model']}
          />
          {errors['llm.model'] && <p className="text-xs text-destructive mt-1">{errors['llm.model']}</p>}
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
            aria-invalid={!!errors['llm.apiKey']}
          />
          {errors['llm.apiKey'] && <p className="text-xs text-destructive mt-1">{errors['llm.apiKey']}</p>}
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
            aria-invalid={!!errors['llm.router']}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive"
          >
            {LLM_ROUTERS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {errors['llm.router'] && <p className="text-xs text-destructive mt-1">{errors['llm.router']}</p>}
        </div>

        {/* Max Iterations */}
        <div>
          <LabelWithTooltip htmlFor="maxIterations" tooltip="Maximum number of agent reasoning iterations per turn">
            Max Iterations
          </LabelWithTooltip>
          <Input
            id="maxIterations"
            type="number"
            value={value.maxIterations !== undefined ? value.maxIterations : 50}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '') {
                handleChange('maxIterations', undefined);
              } else {
                const num = parseInt(val, 10);
                if (!isNaN(num)) {
                  handleChange('maxIterations', num);
                }
              }
            }}
            min="1"
            placeholder="50"
            aria-invalid={!!errors['llm.maxIterations']}
          />
          {errors['llm.maxIterations'] && <p className="text-xs text-destructive mt-1">{errors['llm.maxIterations']}</p>}
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
            aria-invalid={!!errors['llm.baseURL']}
          />
          {errors['llm.baseURL'] && <p className="text-xs text-destructive mt-1">{errors['llm.baseURL']}</p>}
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
            aria-invalid={!!errors['llm.temperature']}
          />
          {errors['llm.temperature'] && <p className="text-xs text-destructive mt-1">{errors['llm.temperature']}</p>}
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
              aria-invalid={!!errors['llm.maxInputTokens']}
            />
            {errors['llm.maxInputTokens'] && <p className="text-xs text-destructive mt-1">{errors['llm.maxInputTokens']}</p>}
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
              aria-invalid={!!errors['llm.maxOutputTokens']}
            />
            {errors['llm.maxOutputTokens'] && <p className="text-xs text-destructive mt-1">{errors['llm.maxOutputTokens']}</p>}
          </div>
        </div>
      </div>
    </Collapsible>
  );
}
