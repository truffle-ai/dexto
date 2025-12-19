import React, { useEffect, useRef, useState } from 'react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Loader2, Plus, X, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { cn } from '../../lib/utils';
import { validateBaseURL } from './types';
import { useValidateOpenRouterModel } from '../hooks/useOpenRouter';
import { useProviderApiKey, type LLMProvider } from '../hooks/useLLM';

export type CustomModelProvider = 'openai-compatible' | 'openrouter' | 'litellm' | 'glama';

export interface CustomModelFormData {
    provider: CustomModelProvider;
    name: string;
    baseURL: string;
    displayName: string;
    maxInputTokens: string;
    maxOutputTokens: string;
    apiKey: string;
}

interface CustomModelFormProps {
    formData: CustomModelFormData;
    onChange: (updates: Partial<CustomModelFormData>) => void;
    onSubmit: () => void;
    onCancel: () => void;
    isSubmitting?: boolean;
    error?: string | null;
}

const PROVIDER_OPTIONS: { value: CustomModelProvider; label: string; description: string }[] = [
    {
        value: 'openai-compatible',
        label: 'OpenAI-Compatible',
        description: 'Local or self-hosted models (Ollama, vLLM, etc.)',
    },
    {
        value: 'openrouter',
        label: 'OpenRouter',
        description: 'Access 100+ models via OpenRouter API',
    },
    {
        value: 'litellm',
        label: 'LiteLLM',
        description: 'Unified proxy for 100+ LLM providers',
    },
    {
        value: 'glama',
        label: 'Glama',
        description: 'OpenAI-compatible gateway for multiple providers',
    },
];

/**
 * Unified custom model form with provider dropdown
 */
export function CustomModelForm({
    formData,
    onChange,
    onSubmit,
    onCancel,
    isSubmitting,
    error,
}: CustomModelFormProps) {
    const { mutateAsync: validateOpenRouterModel } = useValidateOpenRouterModel();
    const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [showApiKey, setShowApiKey] = useState(false);

    const [localError, setLocalError] = useState<string | null>(null);
    const [validation, setValidation] = useState<{
        status: 'idle' | 'validating' | 'valid' | 'invalid';
        error?: string;
    }>({ status: 'idle' });

    // Fetch provider API key for pre-population
    const { data: providerKeyData } = useProviderApiKey(formData.provider as LLMProvider);

    // Pre-populate API key when provider key data is fetched (only if form apiKey is empty)
    useEffect(() => {
        if (providerKeyData?.apiKey && !formData.apiKey) {
            onChange({ apiKey: providerKeyData.apiKey });
        }
    }, [providerKeyData?.apiKey, formData.apiKey, onChange]);

    // Reset validation when provider changes
    useEffect(() => {
        setValidation({ status: 'idle' });
        setLocalError(null);
        setShowApiKey(false);
    }, [formData.provider]);

    // Debounced validation for OpenRouter
    useEffect(() => {
        if (formData.provider !== 'openrouter') return;

        const modelId = formData.name.trim();

        // Reset if empty
        if (!modelId) {
            setValidation({ status: 'idle' });
            return;
        }

        // Check format first (must contain /)
        if (!modelId.includes('/')) {
            setValidation({
                status: 'invalid',
                error: 'Format: provider/model (e.g., anthropic/claude-3.5-sonnet)',
            });
            return;
        }

        // Clear previous timer
        if (validationTimerRef.current) {
            clearTimeout(validationTimerRef.current);
        }

        // Set validating state
        setValidation({ status: 'validating' });

        // Debounce API call
        validationTimerRef.current = setTimeout(async () => {
            try {
                const result = await validateOpenRouterModel(modelId);
                if (result.valid) {
                    setValidation({ status: 'valid' });
                } else {
                    setValidation({
                        status: 'invalid',
                        error: result.error || `Model '${modelId}' not found`,
                    });
                }
            } catch {
                setValidation({
                    status: 'invalid',
                    error: 'Validation failed - check model ID',
                });
            }
        }, 500);

        return () => {
            if (validationTimerRef.current) {
                clearTimeout(validationTimerRef.current);
            }
        };
    }, [formData.name, formData.provider, validateOpenRouterModel]);

    const handleSubmit = () => {
        // Validate based on provider
        if (formData.provider === 'openai-compatible' || formData.provider === 'litellm') {
            if (!formData.name.trim()) {
                setLocalError('Model name is required');
                return;
            }
            if (!formData.baseURL.trim()) {
                setLocalError('Base URL is required');
                return;
            }
            const urlValidation = validateBaseURL(formData.baseURL);
            if (!urlValidation.isValid) {
                setLocalError(urlValidation.error || 'Invalid Base URL');
                return;
            }
        } else if (formData.provider === 'openrouter') {
            if (validation.status !== 'valid') {
                return;
            }
        } else if (formData.provider === 'glama') {
            // Glama requires model name in provider/model format
            if (!formData.name.trim()) {
                setLocalError('Model name is required');
                return;
            }
            if (!formData.name.includes('/')) {
                setLocalError('Glama models use format: provider/model (e.g., openai/gpt-4o)');
                return;
            }
        }
        setLocalError(null);
        onSubmit();
    };

    const isOpenRouter = formData.provider === 'openrouter';
    const isLiteLLM = formData.provider === 'litellm';
    const isGlama = formData.provider === 'glama';
    // OpenRouter and Glama have fixed endpoints (no baseURL needed from user)
    const requiresBaseURL = !isOpenRouter && !isGlama;
    const isValid = isOpenRouter ? validation.status === 'valid' : true;
    const isInvalid = isOpenRouter && validation.status === 'invalid';
    const isValidating = isOpenRouter && validation.status === 'validating';

    const canSubmit = isOpenRouter
        ? validation.status === 'valid' && formData.name.trim()
        : isGlama
          ? formData.name.trim() && formData.name.includes('/')
          : formData.name.trim() && formData.baseURL.trim();

    const displayError = localError || error || (isInvalid && validation.error);

    const selectedProvider = PROVIDER_OPTIONS.find((p) => p.value === formData.provider);

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
                <h3 className="text-sm font-semibold text-foreground">Add Custom Model</h3>
                <button
                    onClick={onCancel}
                    className="p-1.5 rounded-md hover:bg-muted transition-colors"
                >
                    <X className="h-4 w-4 text-muted-foreground" />
                </button>
            </div>

            {/* Form Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Error Display */}
                {displayError && (
                    <div className="p-2 rounded-md bg-destructive/10 border border-destructive/30">
                        <p className="text-xs text-destructive">{displayError}</p>
                    </div>
                )}

                {/* Provider Dropdown */}
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Provider</label>
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setDropdownOpen(!dropdownOpen)}
                            className={cn(
                                'w-full flex items-center justify-between px-3 py-2 rounded-md',
                                'bg-muted/50 border border-border/50 text-sm',
                                'hover:bg-muted transition-colors',
                                dropdownOpen && 'ring-2 ring-ring'
                            )}
                        >
                            <span className="text-foreground">{selectedProvider?.label}</span>
                            <ChevronDown
                                className={cn(
                                    'h-4 w-4 text-muted-foreground transition-transform',
                                    dropdownOpen && 'rotate-180'
                                )}
                            />
                        </button>
                        {dropdownOpen && (
                            <div className="absolute z-50 w-full mt-1 rounded-md border border-border bg-popover shadow-lg">
                                {PROVIDER_OPTIONS.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => {
                                            onChange({
                                                provider: option.value,
                                                name: '',
                                                baseURL: '',
                                                displayName: '',
                                                apiKey: '',
                                            });
                                            setDropdownOpen(false);
                                        }}
                                        className={cn(
                                            'w-full px-3 py-2 text-left hover:bg-accent transition-colors',
                                            'first:rounded-t-md last:rounded-b-md',
                                            formData.provider === option.value && 'bg-accent/50'
                                        )}
                                    >
                                        <div className="text-sm font-medium">{option.label}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {option.description}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Model Name/ID */}
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                        {isOpenRouter ? 'Model ID' : 'Model Name'} *
                    </label>
                    <div className="relative">
                        <Input
                            value={formData.name}
                            onChange={(e) => {
                                onChange({ name: e.target.value });
                                setLocalError(null);
                            }}
                            placeholder={
                                isOpenRouter
                                    ? 'e.g., anthropic/claude-3.5-sonnet'
                                    : isGlama
                                      ? 'e.g., openai/gpt-4o, anthropic/claude-3-sonnet'
                                      : isLiteLLM
                                        ? 'e.g., gpt-4, claude-3-sonnet'
                                        : 'e.g., llama3.2:latest'
                            }
                            className={cn(
                                'h-9 text-sm pr-8',
                                isOpenRouter &&
                                    isValid &&
                                    'border-green-500 focus-visible:ring-green-500',
                                isOpenRouter &&
                                    isInvalid &&
                                    'border-red-500 focus-visible:ring-red-500'
                            )}
                        />
                        {/* Validation status indicator for OpenRouter */}
                        {isOpenRouter && formData.name.trim() && (
                            <div className="absolute right-2 top-1/2 -translate-y-1/2">
                                {isValidating && (
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                )}
                                {isValid && (
                                    <svg
                                        className="h-4 w-4 text-green-500"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M5 13l4 4L19 7"
                                        />
                                    </svg>
                                )}
                                {isInvalid && <X className="h-4 w-4 text-red-500" />}
                            </div>
                        )}
                    </div>
                    {isOpenRouter && (
                        <p className="text-[10px] text-muted-foreground">
                            Find model IDs at{' '}
                            <a
                                href="https://openrouter.ai/models"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                            >
                                openrouter.ai/models
                            </a>
                        </p>
                    )}
                    {isGlama && (
                        <p className="text-[10px] text-muted-foreground">
                            Format: provider/model (e.g., openai/gpt-4o). See{' '}
                            <a
                                href="https://glama.ai/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                            >
                                glama.ai
                            </a>{' '}
                            for supported providers.
                        </p>
                    )}
                </div>

                {/* Base URL - for OpenAI-compatible and LiteLLM */}
                {requiresBaseURL && (
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                            Base URL *
                        </label>
                        <Input
                            value={formData.baseURL}
                            onChange={(e) => {
                                onChange({ baseURL: e.target.value });
                                setLocalError(null);
                            }}
                            placeholder={
                                isLiteLLM
                                    ? 'e.g., http://localhost:4000'
                                    : 'e.g., http://localhost:11434/v1'
                            }
                            className="h-9 text-sm"
                        />
                        <p className="text-[10px] text-muted-foreground">
                            {isLiteLLM
                                ? 'Your LiteLLM proxy URL'
                                : 'The API endpoint URL (must include /v1 for OpenAI-compatible APIs)'}
                        </p>
                    </div>
                )}

                {/* Display Name - optional */}
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                        Display Name <span className="text-muted-foreground/60">(optional)</span>
                    </label>
                    <Input
                        value={formData.displayName}
                        onChange={(e) => onChange({ displayName: e.target.value })}
                        placeholder="Friendly name for the model"
                        className="h-9 text-sm"
                    />
                </div>

                {/* API Key - optional, with eye toggle */}
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                        API Key <span className="text-muted-foreground/60">(optional)</span>
                    </label>
                    <div className="relative">
                        <Input
                            value={formData.apiKey}
                            onChange={(e) => onChange({ apiKey: e.target.value })}
                            placeholder={
                                providerKeyData?.hasKey
                                    ? 'Using provider key (enter to override)'
                                    : 'Enter API key for this endpoint'
                            }
                            type={showApiKey ? 'text' : 'password'}
                            className="h-9 text-sm pr-10"
                        />
                        <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted transition-colors"
                        >
                            {showApiKey ? (
                                <EyeOff className="h-4 w-4 text-muted-foreground" />
                            ) : (
                                <Eye className="h-4 w-4 text-muted-foreground" />
                            )}
                        </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                        {formData.provider === 'openai-compatible'
                            ? 'Required if your endpoint needs authentication'
                            : providerKeyData?.hasKey
                              ? `Overrides ${providerKeyData.envVar} for this model`
                              : `Saved as ${providerKeyData?.envVar || 'provider env var'} for reuse`}
                    </p>
                </div>

                {/* Token limits - for OpenAI-compatible and LiteLLM */}
                {requiresBaseURL && (
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">
                                Max Input Tokens
                            </label>
                            <Input
                                value={formData.maxInputTokens}
                                onChange={(e) => onChange({ maxInputTokens: e.target.value })}
                                placeholder="128000"
                                type="number"
                                className="h-9 text-sm"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">
                                Max Output Tokens
                            </label>
                            <Input
                                value={formData.maxOutputTokens}
                                onChange={(e) => onChange({ maxOutputTokens: e.target.value })}
                                placeholder="Optional"
                                type="number"
                                className="h-9 text-sm"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 px-4 py-3 border-t border-border/30 flex gap-2">
                <Button variant="outline" onClick={onCancel} className="flex-1 h-9 text-sm">
                    Cancel
                </Button>
                <Button
                    onClick={handleSubmit}
                    disabled={isSubmitting || !canSubmit}
                    className="flex-1 h-9 text-sm"
                >
                    {isSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                        <Plus className="h-4 w-4 mr-2" />
                    )}
                    Add & Select Model
                </Button>
            </div>
        </div>
    );
}
