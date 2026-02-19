import React, { useState } from 'react';
import { Input } from '../../ui/input';
import { LabelWithTooltip } from '../../ui/label-with-tooltip';
import { Collapsible } from '../../ui/collapsible';
import { Eye, EyeOff } from 'lucide-react';
import { useModelCapabilities } from '../../hooks/useLLM';
import { LLM_PROVIDERS } from '@dexto/core';
import type { AgentConfig } from '@dexto/agent-config';

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
    const [showApiKey, setShowApiKey] = useState(false);
    const { data: capabilities } = useModelCapabilities(
        value.provider ?? null,
        value.model ?? null
    );
    const reasoningPresets = capabilities?.reasoning?.supportedPresets ?? [];

    const handleChange = <K extends keyof LLMConfig>(field: K, newValue: LLMConfig[K]) => {
        onChange({ ...value, [field]: newValue });
    };

    return (
        <Collapsible
            title="LLM Configuration"
            defaultOpen={true}
            open={open}
            onOpenChange={onOpenChange}
            errorCount={errorCount}
            sectionErrors={sectionErrors}
        >
            <div className="space-y-4">
                {/* Provider */}
                <div>
                    <LabelWithTooltip
                        htmlFor="provider"
                        tooltip="The LLM provider to use (e.g., OpenAI, Anthropic)"
                    >
                        Provider *
                    </LabelWithTooltip>
                    <select
                        id="provider"
                        value={value.provider || ''}
                        onChange={(e) =>
                            handleChange('provider', e.target.value as LLMConfig['provider'])
                        }
                        aria-invalid={!!errors['llm.provider']}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive"
                    >
                        <option value="">Select provider...</option>
                        {LLM_PROVIDERS.map((p) => (
                            <option key={p} value={p}>
                                {p === 'dexto-nova' ? 'Dexto Nova' : p}
                            </option>
                        ))}
                    </select>
                    {errors['llm.provider'] && (
                        <p className="text-xs text-destructive mt-1">{errors['llm.provider']}</p>
                    )}
                </div>

                {/* Model */}
                <div>
                    <LabelWithTooltip
                        htmlFor="model"
                        tooltip="The specific model identifier (e.g., gpt-5, claude-sonnet-4-5-20250929)"
                    >
                        Model *
                    </LabelWithTooltip>
                    <Input
                        id="model"
                        value={value.model || ''}
                        onChange={(e) => handleChange('model', e.target.value)}
                        placeholder="e.g., gpt-5, claude-sonnet-4-5-20250929"
                        aria-invalid={!!errors['llm.model']}
                    />
                    {errors['llm.model'] && (
                        <p className="text-xs text-destructive mt-1">{errors['llm.model']}</p>
                    )}
                </div>

                {/* API Key */}
                <div>
                    <LabelWithTooltip
                        htmlFor="apiKey"
                        tooltip="Use $ENV_VAR for environment variables or enter the API key directly"
                    >
                        API Key *
                    </LabelWithTooltip>
                    <div className="relative">
                        <Input
                            id="apiKey"
                            type={showApiKey ? 'text' : 'password'}
                            value={value.apiKey ?? ''}
                            onChange={(e) => handleChange('apiKey', e.target.value)}
                            placeholder="$OPENAI_API_KEY or direct value"
                            aria-invalid={!!errors['llm.apiKey']}
                            className="pr-10"
                        />
                        <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-accent rounded transition-colors"
                            aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                        >
                            {showApiKey ? (
                                <EyeOff className="h-4 w-4 text-muted-foreground" />
                            ) : (
                                <Eye className="h-4 w-4 text-muted-foreground" />
                            )}
                        </button>
                    </div>
                    {errors['llm.apiKey'] && (
                        <p className="text-xs text-destructive mt-1">{errors['llm.apiKey']}</p>
                    )}
                </div>

                {/* Max Iterations */}
                <div>
                    <LabelWithTooltip
                        htmlFor="maxIterations"
                        tooltip="Maximum number of agent reasoning iterations per turn"
                    >
                        Max Iterations
                    </LabelWithTooltip>
                    <Input
                        id="maxIterations"
                        type="number"
                        value={value.maxIterations !== undefined ? value.maxIterations : ''}
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
                    {errors['llm.maxIterations'] && (
                        <p className="text-xs text-destructive mt-1">
                            {errors['llm.maxIterations']}
                        </p>
                    )}
                </div>

                {/* Base URL */}
                <div>
                    <LabelWithTooltip
                        htmlFor="baseURL"
                        tooltip="Custom base URL for the LLM provider (optional, for proxies or custom endpoints)"
                    >
                        Base URL
                    </LabelWithTooltip>
                    <Input
                        id="baseURL"
                        value={value.baseURL || ''}
                        onChange={(e) => handleChange('baseURL', e.target.value || undefined)}
                        placeholder="https://api.openai.com/v1"
                        aria-invalid={!!errors['llm.baseURL']}
                    />
                    {errors['llm.baseURL'] && (
                        <p className="text-xs text-destructive mt-1">{errors['llm.baseURL']}</p>
                    )}
                </div>

                {/* Temperature */}
                <div>
                    <LabelWithTooltip
                        htmlFor="temperature"
                        tooltip="Controls randomness in responses (0.0 = deterministic, 1.0 = creative)"
                    >
                        Temperature
                    </LabelWithTooltip>
                    <Input
                        id="temperature"
                        type="number"
                        value={value.temperature !== undefined ? value.temperature : ''}
                        onChange={(e) =>
                            handleChange(
                                'temperature',
                                e.target.value ? parseFloat(e.target.value) : undefined
                            )
                        }
                        min="0"
                        max="1"
                        step="0.1"
                        placeholder="0.0 - 1.0"
                        aria-invalid={!!errors['llm.temperature']}
                    />
                    {errors['llm.temperature'] && (
                        <p className="text-xs text-destructive mt-1">{errors['llm.temperature']}</p>
                    )}
                </div>

                {/* Max Input/Output Tokens */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <LabelWithTooltip
                            htmlFor="maxInputTokens"
                            tooltip="Maximum input tokens to send to the model. If not specified, defaults to model's limit from registry, or 128,000 tokens for custom endpoints"
                        >
                            Max Input Tokens
                        </LabelWithTooltip>
                        <Input
                            id="maxInputTokens"
                            type="number"
                            value={value.maxInputTokens || ''}
                            onChange={(e) =>
                                handleChange(
                                    'maxInputTokens',
                                    e.target.value ? parseInt(e.target.value, 10) : undefined
                                )
                            }
                            min="1"
                            placeholder="Auto (128k fallback)"
                            aria-invalid={!!errors['llm.maxInputTokens']}
                        />
                        {errors['llm.maxInputTokens'] && (
                            <p className="text-xs text-destructive mt-1">
                                {errors['llm.maxInputTokens']}
                            </p>
                        )}
                    </div>
                    <div>
                        <LabelWithTooltip
                            htmlFor="maxOutputTokens"
                            tooltip="Maximum output tokens the model can generate. If not specified, uses provider's default (typically 4,096 tokens)"
                        >
                            Max Output Tokens
                        </LabelWithTooltip>
                        <Input
                            id="maxOutputTokens"
                            type="number"
                            value={value.maxOutputTokens || ''}
                            onChange={(e) =>
                                handleChange(
                                    'maxOutputTokens',
                                    e.target.value ? parseInt(e.target.value, 10) : undefined
                                )
                            }
                            min="1"
                            placeholder="Auto (provider default)"
                            aria-invalid={!!errors['llm.maxOutputTokens']}
                        />
                        {errors['llm.maxOutputTokens'] && (
                            <p className="text-xs text-destructive mt-1">
                                {errors['llm.maxOutputTokens']}
                            </p>
                        )}
                    </div>
                </div>

                {/* Provider-Specific Options */}

                {/* Reasoning tuning (server-resolved; safe for gateway providers). */}
                {value.provider && value.model && reasoningPresets.length > 0 && (
                    <div>
                        <LabelWithTooltip
                            htmlFor="reasoningPreset"
                            tooltip="Controls reasoning tuning. Availability depends on provider+model (resolved by the server)."
                        >
                            Reasoning
                        </LabelWithTooltip>
                        <select
                            id="reasoningPreset"
                            value={
                                value.reasoning?.preset === 'auto'
                                    ? ''
                                    : value.reasoning?.preset || ''
                            }
                            onChange={(e) =>
                                handleChange(
                                    'reasoning',
                                    e.target.value
                                        ? ({ preset: e.target.value } as LLMConfig['reasoning'])
                                        : undefined
                                )
                            }
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            <option value="">Auto (provider/model default)</option>
                            {reasoningPresets
                                .filter((p) => p !== 'auto')
                                .map((preset) => (
                                    <option key={preset} value={preset}>
                                        {preset}
                                    </option>
                                ))}
                        </select>
                        <p className="text-xs text-muted-foreground mt-1">
                            Supported presets: {reasoningPresets.join(', ')}
                        </p>
                    </div>
                )}
            </div>
        </Collapsible>
    );
}
