import React, { useEffect, useRef, useState } from 'react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import {
    Loader2,
    Plus,
    X,
    ChevronDown,
    Eye,
    EyeOff,
    Check,
    ExternalLink,
    Info,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { validateBaseURL } from './types';
import { useValidateOpenRouterModel } from '../hooks/useOpenRouter';
import { useProviderApiKey, type LLMProvider } from '../hooks/useLLM';
import { useValidateLocalFile } from '../hooks/useModels';
import { useDextoAuth } from '../hooks/useDextoAuth';

const BEDROCK_DOCS_URL = 'https://docs.dexto.ai/docs/guides/supported-llm-providers#amazon-bedrock';

// 'vertex' is TODO - see comment in PROVIDER_OPTIONS.
export type CustomModelProvider =
    | 'openai-compatible'
    | 'openrouter'
    | 'litellm'
    | 'glama'
    | 'amazon-bedrock'
    | 'ollama'
    | 'local'
    | 'dexto-nova';

export interface CustomModelFormData {
    provider: CustomModelProvider;
    name: string;
    baseURL: string;
    displayName: string;
    maxInputTokens: string;
    maxOutputTokens: string;
    apiKey: string;
    filePath: string;
}

interface CustomModelFormProps {
    formData: CustomModelFormData;
    onChange: (updates: Partial<CustomModelFormData>) => void;
    onSubmit: () => void;
    onCancel: () => void;
    isSubmitting?: boolean;
    error?: string | null;
    isEditing?: boolean;
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
    {
        value: 'amazon-bedrock',
        label: 'AWS Bedrock',
        description: 'Custom Bedrock model IDs (uses AWS credentials)',
    },
    {
        value: 'ollama',
        label: 'Ollama',
        description: 'Local Ollama server models',
    },
    {
        value: 'local',
        label: 'Local (GGUF)',
        description: 'Custom GGUF files via node-llama-cpp',
    },
    // TODO: Add 'vertex' provider for custom Vertex AI model IDs (uses ADC auth like Bedrock)
    // Would allow users to add model IDs not yet in registry (e.g., new Gemini previews)
];

// Dexto option is feature-flagged - shown separately when enabled
const DEXTO_PROVIDER_OPTION = {
    value: 'dexto-nova' as const,
    label: 'Dexto Nova',
    description: 'Access 100+ models with Nova credits (login required)',
};

// ============================================================================
// Provider-specific field components
// ============================================================================

interface ProviderFieldsProps {
    formData: CustomModelFormData;
    onChange: (updates: Partial<CustomModelFormData>) => void;
    setLocalError: (error: string | null) => void;
    providerKeyData?: { hasKey: boolean; envVar: string };
}

/**
 * Bedrock fields - just model ID, display name, max tokens
 * No API key (uses AWS credentials)
 */
function BedrockFields({ formData, onChange, setLocalError }: ProviderFieldsProps) {
    return (
        <>
            {/* Setup Guide Banner */}
            <div className="p-3 rounded-md bg-blue-500/10 border border-blue-500/30">
                <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="space-y-1">
                        <p className="text-xs text-blue-700 dark:text-blue-300">
                            Bedrock uses AWS credentials from your environment.
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Make sure{' '}
                            <code className="px-1 py-0.5 rounded bg-muted text-[10px]">
                                AWS_REGION
                            </code>{' '}
                            and either{' '}
                            <code className="px-1 py-0.5 rounded bg-muted text-[10px]">
                                AWS_BEARER_TOKEN_BEDROCK
                            </code>{' '}
                            or IAM credentials are set.
                        </p>
                        <a
                            href={BEDROCK_DOCS_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                        >
                            View setup guide
                            <ExternalLink className="h-3 w-3" />
                        </a>
                    </div>
                </div>
            </div>

            {/* Model ID */}
            <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Model ID *</label>
                <Input
                    value={formData.name}
                    onChange={(e) => {
                        onChange({ name: e.target.value });
                        setLocalError(null);
                    }}
                    placeholder="e.g., anthropic.claude-3-haiku-20240307-v1:0"
                    className="h-9 text-sm"
                />
                <p className="text-[10px] text-muted-foreground">
                    Find model IDs in the{' '}
                    <a
                        href="https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                    >
                        AWS Bedrock documentation
                    </a>
                </p>
            </div>

            {/* Display Name */}
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

            {/* Max Input Tokens */}
            <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                    Max Input Tokens <span className="text-muted-foreground/60">(optional)</span>
                </label>
                <Input
                    value={formData.maxInputTokens}
                    onChange={(e) => onChange({ maxInputTokens: e.target.value })}
                    placeholder="e.g., 200000 (leave blank for default)"
                    type="number"
                    className="h-9 text-sm"
                />
            </div>
        </>
    );
}

/**
 * OpenRouter fields - model ID with live validation, API key
 */
function OpenRouterFields({
    formData,
    onChange,
    setLocalError,
    providerKeyData,
}: ProviderFieldsProps) {
    const { mutateAsync: validateOpenRouterModel } = useValidateOpenRouterModel();
    const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [showApiKey, setShowApiKey] = useState(false);
    const [validation, setValidation] = useState<{
        status: 'idle' | 'validating' | 'valid' | 'invalid';
        error?: string;
    }>({ status: 'idle' });

    // Debounced validation
    useEffect(() => {
        const modelId = formData.name.trim();
        if (!modelId) {
            setValidation({ status: 'idle' });
            return;
        }
        if (!modelId.includes('/')) {
            setValidation({
                status: 'invalid',
                error: 'Format: provider/model (e.g., anthropic/claude-3.5-sonnet)',
            });
            return;
        }
        if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
        setValidation({ status: 'validating' });
        validationTimerRef.current = setTimeout(async () => {
            try {
                const result = await validateOpenRouterModel(modelId);
                setValidation(
                    result.valid
                        ? { status: 'valid' }
                        : {
                              status: 'invalid',
                              error: result.error || `Model '${modelId}' not found`,
                          }
                );
            } catch {
                setValidation({ status: 'invalid', error: 'Validation failed - check model ID' });
            }
        }, 500);
        return () => {
            if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
        };
    }, [formData.name, validateOpenRouterModel]);

    const isValid = validation.status === 'valid';
    const isInvalid = validation.status === 'invalid';
    const isValidating = validation.status === 'validating';

    return (
        <>
            {/* Model ID */}
            <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Model ID *</label>
                <div className="relative">
                    <Input
                        value={formData.name}
                        onChange={(e) => {
                            onChange({ name: e.target.value });
                            setLocalError(null);
                        }}
                        placeholder="e.g., anthropic/claude-3.5-sonnet"
                        className={cn(
                            'h-9 text-sm pr-8',
                            isValid && 'border-green-500 focus-visible:ring-green-500',
                            isInvalid && 'border-red-500 focus-visible:ring-red-500'
                        )}
                    />
                    {formData.name.trim() && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2">
                            {isValidating && (
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            )}
                            {isValid && <Check className="h-4 w-4 text-green-500" />}
                            {isInvalid && <X className="h-4 w-4 text-red-500" />}
                        </div>
                    )}
                </div>
                {isInvalid && validation.error && (
                    <p className="text-[10px] text-red-500">{validation.error}</p>
                )}
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
            </div>

            {/* Display Name */}
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

            {/* API Key */}
            <ApiKeyField
                formData={formData}
                onChange={onChange}
                providerKeyData={providerKeyData}
                showApiKey={showApiKey}
                setShowApiKey={setShowApiKey}
            />
        </>
    );
}

/**
 * Glama fields - model ID (provider/model format), API key
 */
function GlamaFields({ formData, onChange, setLocalError, providerKeyData }: ProviderFieldsProps) {
    const [showApiKey, setShowApiKey] = useState(false);

    return (
        <>
            {/* Model ID */}
            <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Model ID *</label>
                <Input
                    value={formData.name}
                    onChange={(e) => {
                        onChange({ name: e.target.value });
                        setLocalError(null);
                    }}
                    placeholder="e.g., openai/gpt-4o, anthropic/claude-3-sonnet"
                    className="h-9 text-sm"
                />
                <p className="text-[10px] text-muted-foreground">
                    Format: provider/model. See{' '}
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
            </div>

            {/* Display Name */}
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

            {/* API Key */}
            <ApiKeyField
                formData={formData}
                onChange={onChange}
                providerKeyData={providerKeyData}
                showApiKey={showApiKey}
                setShowApiKey={setShowApiKey}
            />
        </>
    );
}

/**
 * OpenAI-Compatible fields - model name, baseURL (required), API key, token limits
 */
function OpenAICompatibleFields({
    formData,
    onChange,
    setLocalError,
    providerKeyData,
}: ProviderFieldsProps) {
    const [showApiKey, setShowApiKey] = useState(false);

    return (
        <>
            {/* Model Name */}
            <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Model Name *</label>
                <Input
                    value={formData.name}
                    onChange={(e) => {
                        onChange({ name: e.target.value });
                        setLocalError(null);
                    }}
                    placeholder="e.g., llama3.2:latest"
                    className="h-9 text-sm"
                />
            </div>

            {/* Base URL */}
            <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Base URL *</label>
                <Input
                    value={formData.baseURL}
                    onChange={(e) => {
                        onChange({ baseURL: e.target.value });
                        setLocalError(null);
                    }}
                    placeholder="e.g., http://localhost:11434/v1"
                    className="h-9 text-sm"
                />
                <p className="text-[10px] text-muted-foreground">
                    The API endpoint URL (must include /v1 for OpenAI-compatible APIs)
                </p>
            </div>

            {/* Display Name */}
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

            {/* API Key */}
            <ApiKeyField
                formData={formData}
                onChange={onChange}
                providerKeyData={providerKeyData}
                showApiKey={showApiKey}
                setShowApiKey={setShowApiKey}
                placeholder="Required if your endpoint needs authentication"
            />

            {/* Token limits */}
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
        </>
    );
}

/**
 * LiteLLM fields - model name, baseURL (required), API key, token limits
 */
function LiteLLMFields({
    formData,
    onChange,
    setLocalError,
    providerKeyData,
}: ProviderFieldsProps) {
    const [showApiKey, setShowApiKey] = useState(false);

    return (
        <>
            {/* Model Name */}
            <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Model Name *</label>
                <Input
                    value={formData.name}
                    onChange={(e) => {
                        onChange({ name: e.target.value });
                        setLocalError(null);
                    }}
                    placeholder="e.g., gpt-4, claude-3-sonnet"
                    className="h-9 text-sm"
                />
            </div>

            {/* Base URL */}
            <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                    LiteLLM Proxy URL *
                </label>
                <Input
                    value={formData.baseURL}
                    onChange={(e) => {
                        onChange({ baseURL: e.target.value });
                        setLocalError(null);
                    }}
                    placeholder="e.g., http://localhost:4000"
                    className="h-9 text-sm"
                />
                <p className="text-[10px] text-muted-foreground">Your LiteLLM proxy URL</p>
            </div>

            {/* Display Name */}
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

            {/* API Key */}
            <ApiKeyField
                formData={formData}
                onChange={onChange}
                providerKeyData={providerKeyData}
                showApiKey={showApiKey}
                setShowApiKey={setShowApiKey}
            />

            {/* Token limits */}
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
        </>
    );
}

/**
 * Ollama fields - model name, optional baseURL
 * No API key required
 */
function OllamaFields({ formData, onChange, setLocalError }: ProviderFieldsProps) {
    return (
        <>
            {/* Setup Guide Banner */}
            <div className="p-3 rounded-md bg-blue-500/10 border border-blue-500/30">
                <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="space-y-1">
                        <p className="text-xs text-blue-700 dark:text-blue-300">
                            Ollama must be installed and running.
                        </p>
                        <a
                            href="https://ollama.ai"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                        >
                            Get Ollama
                            <ExternalLink className="h-3 w-3" />
                        </a>
                    </div>
                </div>
            </div>

            {/* Model Name */}
            <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Model Name *</label>
                <Input
                    value={formData.name}
                    onChange={(e) => {
                        onChange({ name: e.target.value });
                        setLocalError(null);
                    }}
                    placeholder="e.g., llama3.2:latest, mistral:7b"
                    className="h-9 text-sm"
                />
                <p className="text-[10px] text-muted-foreground">
                    Run{' '}
                    <code className="px-1 py-0.5 rounded bg-muted text-[10px]">ollama list</code> to
                    see available models
                </p>
            </div>

            {/* Base URL (optional) */}
            <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                    Ollama URL <span className="text-muted-foreground/60">(optional)</span>
                </label>
                <Input
                    value={formData.baseURL}
                    onChange={(e) => onChange({ baseURL: e.target.value })}
                    placeholder="http://localhost:11434 (default)"
                    className="h-9 text-sm"
                />
            </div>

            {/* Display Name */}
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
        </>
    );
}

/**
 * Local GGUF fields - model ID, file path with validation
 * No API key required
 */
function LocalFields({ formData, onChange, setLocalError }: ProviderFieldsProps) {
    const { mutateAsync: validateFile } = useValidateLocalFile();
    const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [validation, setValidation] = useState<{
        status: 'idle' | 'validating' | 'valid' | 'invalid';
        sizeBytes?: number;
        error?: string;
    }>({ status: 'idle' });

    // Debounced file validation
    useEffect(() => {
        const filePath = formData.filePath?.trim();
        if (!filePath) {
            setValidation({ status: 'idle' });
            return;
        }
        if (!filePath.startsWith('/')) {
            setValidation({ status: 'invalid', error: 'Path must be absolute (start with /)' });
            return;
        }
        if (!filePath.endsWith('.gguf')) {
            setValidation({ status: 'invalid', error: 'File must have .gguf extension' });
            return;
        }
        if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
        setValidation({ status: 'validating' });
        validationTimerRef.current = setTimeout(async () => {
            try {
                const result = await validateFile(filePath);
                setValidation(
                    result.valid
                        ? { status: 'valid', sizeBytes: result.sizeBytes }
                        : { status: 'invalid', error: result.error || 'File not found' }
                );
            } catch {
                setValidation({ status: 'invalid', error: 'Validation failed' });
            }
        }, 500);
        return () => {
            if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
        };
    }, [formData.filePath, validateFile]);

    const isValid = validation.status === 'valid';
    const isInvalid = validation.status === 'invalid';
    const isValidating = validation.status === 'validating';

    // Helper to format file size
    const formatSize = (bytes?: number) => {
        if (!bytes) return '';
        const gb = bytes / (1024 * 1024 * 1024);
        if (gb >= 1) return `${gb.toFixed(1)} GB`;
        const mb = bytes / (1024 * 1024);
        return `${mb.toFixed(0)} MB`;
    };

    return (
        <>
            {/* Setup Guide Banner */}
            <div className="p-3 rounded-md bg-blue-500/10 border border-blue-500/30">
                <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="space-y-1">
                        <p className="text-xs text-blue-700 dark:text-blue-300">
                            Requires node-llama-cpp to be installed.
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Run{' '}
                            <code className="px-1 py-0.5 rounded bg-muted text-[10px]">
                                dexto setup
                            </code>{' '}
                            and select &quot;local&quot; to install dependencies.
                        </p>
                    </div>
                </div>
            </div>

            {/* Model ID */}
            <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Model ID *</label>
                <Input
                    value={formData.name}
                    onChange={(e) => {
                        onChange({ name: e.target.value });
                        setLocalError(null);
                    }}
                    placeholder="e.g., my-custom-llama"
                    className="h-9 text-sm"
                />
                <p className="text-[10px] text-muted-foreground">
                    A unique identifier for this model
                </p>
            </div>

            {/* File Path */}
            <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                    GGUF File Path *
                </label>
                <div className="relative">
                    <Input
                        value={formData.filePath}
                        onChange={(e) => {
                            onChange({ filePath: e.target.value });
                            setLocalError(null);
                        }}
                        placeholder="/path/to/model.gguf"
                        className={cn(
                            'h-9 text-sm pr-8',
                            isValid && 'border-green-500 focus-visible:ring-green-500',
                            isInvalid && 'border-red-500 focus-visible:ring-red-500'
                        )}
                    />
                    {formData.filePath?.trim() && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2">
                            {isValidating && (
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            )}
                            {isValid && <Check className="h-4 w-4 text-green-500" />}
                            {isInvalid && <X className="h-4 w-4 text-red-500" />}
                        </div>
                    )}
                </div>
                {isValid && validation.sizeBytes && (
                    <p className="text-[10px] text-green-600">
                        Found: {formatSize(validation.sizeBytes)}
                    </p>
                )}
                {isInvalid && validation.error && (
                    <p className="text-[10px] text-red-500">{validation.error}</p>
                )}
            </div>

            {/* Display Name */}
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

            {/* Note: Context length is auto-detected by node-llama-cpp from GGUF metadata */}
            <p className="text-[10px] text-muted-foreground/60">
                Context length is automatically detected from the GGUF file.
            </p>
        </>
    );
}

/**
 * Dexto fields - model ID with OpenRouter format, no API key (uses OAuth login)
 */
function DextoFields({ formData, onChange, setLocalError }: ProviderFieldsProps) {
    const { mutateAsync: validateOpenRouterModel } = useValidateOpenRouterModel();
    const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [validation, setValidation] = useState<{
        status: 'idle' | 'validating' | 'valid' | 'invalid';
        error?: string;
    }>({ status: 'idle' });

    // Debounced validation (reuses OpenRouter validation since Dexto uses OpenRouter model IDs)
    useEffect(() => {
        const modelId = formData.name.trim();
        if (!modelId) {
            setValidation({ status: 'idle' });
            return;
        }
        if (!modelId.includes('/')) {
            setValidation({
                status: 'invalid',
                error: 'Format: provider/model (e.g., anthropic/claude-sonnet-4.5)',
            });
            return;
        }
        if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
        setValidation({ status: 'validating' });
        validationTimerRef.current = setTimeout(async () => {
            try {
                const result = await validateOpenRouterModel(modelId);
                setValidation(
                    result.valid
                        ? { status: 'valid' }
                        : {
                              status: 'invalid',
                              error:
                                  result.error ||
                                  `Model '${modelId}' not found. Check https://openrouter.ai/models`,
                          }
                );
            } catch {
                setValidation({ status: 'invalid', error: 'Validation failed - check model ID' });
            }
        }, 500);
        return () => {
            if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
        };
    }, [formData.name, validateOpenRouterModel]);

    const isValid = validation.status === 'valid';
    const isInvalid = validation.status === 'invalid';
    const isValidating = validation.status === 'validating';

    return (
        <>
            {/* Setup Guide Banner */}
            <div className="p-3 rounded-md bg-purple-500/10 border border-purple-500/30">
                <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-purple-500 mt-0.5 flex-shrink-0" />
                    <div className="space-y-1">
                        <p className="text-xs text-purple-700 dark:text-purple-300">
                            Uses your Dexto Nova credits with OpenRouter model IDs.
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Requires login: run{' '}
                            <code className="px-1 py-0.5 rounded bg-muted text-[10px]">
                                dexto login
                            </code>{' '}
                            from the CLI first.
                        </p>
                    </div>
                </div>
            </div>

            {/* Model ID */}
            <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Model ID *</label>
                <div className="relative">
                    <Input
                        value={formData.name}
                        onChange={(e) => {
                            onChange({ name: e.target.value });
                            setLocalError(null);
                        }}
                        placeholder="e.g., anthropic/claude-sonnet-4.5, openai/gpt-5.2"
                        className={cn(
                            'h-9 text-sm pr-8',
                            isValid && 'border-green-500 focus-visible:ring-green-500',
                            isInvalid && 'border-red-500 focus-visible:ring-red-500'
                        )}
                    />
                    {formData.name.trim() && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2">
                            {isValidating && (
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            )}
                            {isValid && <Check className="h-4 w-4 text-green-500" />}
                            {isInvalid && <X className="h-4 w-4 text-red-500" />}
                        </div>
                    )}
                </div>
                {isInvalid && validation.error && (
                    <p className="text-[10px] text-red-500">{validation.error}</p>
                )}
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
            </div>

            {/* Display Name */}
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

            {/* No API Key field - Dexto uses OAuth login */}
        </>
    );
}

/**
 * Reusable API Key field component
 */
function ApiKeyField({
    formData,
    onChange,
    providerKeyData,
    showApiKey,
    setShowApiKey,
    placeholder,
}: {
    formData: CustomModelFormData;
    onChange: (updates: Partial<CustomModelFormData>) => void;
    providerKeyData?: { hasKey: boolean; envVar: string };
    showApiKey: boolean;
    setShowApiKey: (show: boolean) => void;
    placeholder?: string;
}) {
    const hasExistingKey = providerKeyData?.hasKey ?? false;

    return (
        <div className="space-y-1.5">
            <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-muted-foreground">
                    API Key <span className="text-muted-foreground/60">(optional)</span>
                </label>
                {hasExistingKey && !formData.apiKey && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400">
                        <Check className="h-3 w-3" />
                        Configured
                    </span>
                )}
            </div>
            <div className="relative">
                <Input
                    value={formData.apiKey}
                    onChange={(e) => onChange({ apiKey: e.target.value })}
                    placeholder={
                        placeholder ||
                        (hasExistingKey
                            ? 'Leave empty to use existing key'
                            : 'Enter API key for this endpoint')
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
                {hasExistingKey
                    ? formData.apiKey
                        ? `Will override ${providerKeyData?.envVar} for this model`
                        : `Using ${providerKeyData?.envVar}`
                    : `Will be saved as ${providerKeyData?.envVar || 'provider env var'}`}
            </p>
        </div>
    );
}

// ============================================================================
// Main form component
// ============================================================================

/**
 * Unified custom model form with provider dropdown and provider-specific fields
 */
export function CustomModelForm({
    formData,
    onChange,
    onSubmit,
    onCancel,
    isSubmitting,
    error,
    isEditing = false,
}: CustomModelFormProps) {
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);

    // Fetch provider API key status (not the actual key - it's masked for security)
    const { data: providerKeyData } = useProviderApiKey(formData.provider as LLMProvider);

    // Fetch dexto auth status to conditionally show dexto-nova provider option
    const { data: dextoAuthStatus } = useDextoAuth();
    const showDextoProvider = dextoAuthStatus?.enabled ?? false;

    // Build provider options list - include dexto-nova when feature is enabled
    const providerOptions = showDextoProvider
        ? [DEXTO_PROVIDER_OPTION, ...PROVIDER_OPTIONS]
        : PROVIDER_OPTIONS;

    // Reset error when provider changes
    useEffect(() => {
        setLocalError(null);
    }, [formData.provider]);

    // Reset provider to default if dexto-nova is selected but becomes unavailable
    useEffect(() => {
        if (dextoAuthStatus && !showDextoProvider && formData.provider === 'dexto-nova') {
            onChange({
                ...formData,
                provider: 'openai-compatible',
            });
        }
    }, [dextoAuthStatus, showDextoProvider, formData, onChange]);

    const handleSubmit = () => {
        // Provider-specific validation
        switch (formData.provider) {
            case 'openai-compatible':
            case 'litellm': {
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
                break;
            }
            case 'openrouter':
                if (!formData.name.trim()) {
                    setLocalError('Model ID is required');
                    return;
                }
                if (!formData.name.includes('/')) {
                    setLocalError('Format: provider/model (e.g., anthropic/claude-3.5-sonnet)');
                    return;
                }
                break;
            case 'glama':
                if (!formData.name.trim()) {
                    setLocalError('Model ID is required');
                    return;
                }
                if (!formData.name.includes('/')) {
                    setLocalError('Glama models use format: provider/model (e.g., openai/gpt-4o)');
                    return;
                }
                break;
            case 'amazon-bedrock':
                if (!formData.name.trim()) {
                    setLocalError('Model ID is required');
                    return;
                }
                break;
            case 'ollama':
                if (!formData.name.trim()) {
                    setLocalError('Model name is required');
                    return;
                }
                // Optional baseURL validation if provided
                if (formData.baseURL.trim()) {
                    const urlValidation = validateBaseURL(formData.baseURL);
                    if (!urlValidation.isValid) {
                        setLocalError(urlValidation.error || 'Invalid Ollama URL');
                        return;
                    }
                }
                break;
            case 'local':
                if (!formData.name.trim()) {
                    setLocalError('Model ID is required');
                    return;
                }
                if (!formData.filePath?.trim()) {
                    setLocalError('GGUF file path is required');
                    return;
                }
                if (!formData.filePath.startsWith('/')) {
                    setLocalError('File path must be absolute (start with /)');
                    return;
                }
                if (!formData.filePath.endsWith('.gguf')) {
                    setLocalError('File must have .gguf extension');
                    return;
                }
                break;
            case 'dexto-nova':
                if (!formData.name.trim()) {
                    setLocalError('Model ID is required');
                    return;
                }
                if (!formData.name.includes('/')) {
                    setLocalError('Format: provider/model (e.g., anthropic/claude-sonnet-4.5)');
                    return;
                }
                break;
        }
        setLocalError(null);
        onSubmit();
    };

    const canSubmit = (() => {
        switch (formData.provider) {
            case 'openai-compatible':
            case 'litellm':
                return formData.name.trim() && formData.baseURL.trim();
            case 'openrouter':
            case 'glama':
                return formData.name.trim() && formData.name.includes('/');
            case 'amazon-bedrock':
                return formData.name.trim().length > 0;
            case 'ollama':
                return formData.name.trim().length > 0;
            case 'local':
                return (
                    formData.name.trim().length > 0 &&
                    formData.filePath?.trim().startsWith('/') &&
                    formData.filePath?.trim().endsWith('.gguf')
                );
            case 'dexto-nova':
                return formData.name.trim() && formData.name.includes('/');
            default:
                return false;
        }
    })();

    const displayError = localError || error;
    const selectedProvider = providerOptions.find((p) => p.value === formData.provider);

    const renderProviderFields = () => {
        const props: ProviderFieldsProps = {
            formData,
            onChange,
            setLocalError,
            providerKeyData: providerKeyData
                ? {
                      hasKey: providerKeyData.hasKey,
                      envVar: providerKeyData.envVar,
                  }
                : undefined,
        };

        switch (formData.provider) {
            case 'amazon-bedrock':
                return <BedrockFields {...props} />;
            case 'openrouter':
                return <OpenRouterFields {...props} />;
            case 'glama':
                return <GlamaFields {...props} />;
            case 'litellm':
                return <LiteLLMFields {...props} />;
            case 'ollama':
                return <OllamaFields {...props} />;
            case 'local':
                return <LocalFields {...props} />;
            case 'dexto-nova':
                return <DextoFields {...props} />;
            case 'openai-compatible':
            default:
                return <OpenAICompatibleFields {...props} />;
        }
    };

    return (
        <div className="flex flex-col flex-1 min-h-0 max-h-full">
            {/* Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-border/30">
                <h3 className="text-sm font-semibold text-foreground">
                    {isEditing ? 'Edit Custom Model' : 'Add Custom Model'}
                </h3>
                <button
                    onClick={onCancel}
                    className="p-1.5 rounded-md hover:bg-muted transition-colors"
                >
                    <X className="h-4 w-4 text-muted-foreground" />
                </button>
            </div>

            {/* Scrollable Form Content */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
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
                                {providerOptions.map((option) => (
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
                                                maxInputTokens: '',
                                                maxOutputTokens: '',
                                                filePath: '',
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

                {/* Provider-specific fields */}
                {renderProviderFields()}
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
                    ) : isEditing ? (
                        <Check className="h-4 w-4 mr-2" />
                    ) : (
                        <Plus className="h-4 w-4 mr-2" />
                    )}
                    {isEditing ? 'Save & Select Model' : 'Add & Select Model'}
                </Button>
            </div>
        </div>
    );
}
