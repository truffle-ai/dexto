import React, { useEffect, useRef, useState } from 'react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Loader2, Plus, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { validateBaseURL } from './types';
import { useValidateOpenRouterModel } from '../hooks/useOpenRouter';

export interface CustomModelFormData {
    provider: 'openai-compatible' | 'openrouter';
    name: string;
    baseURL: string;
    displayName: string;
    maxInputTokens: string;
    maxOutputTokens: string;
}

interface BaseFormProps {
    formData: CustomModelFormData;
    onChange: (updates: Partial<CustomModelFormData>) => void;
    onSubmit: () => void;
    isSubmitting?: boolean;
}

/**
 * OpenAI-Compatible model form fields
 */
export function OpenAICompatibleForm({
    formData,
    onChange,
    onSubmit,
    isSubmitting,
}: BaseFormProps) {
    const [localError, setLocalError] = useState<string | null>(null);

    const handleSubmit = () => {
        // Validate baseURL
        if (!formData.baseURL.trim()) {
            setLocalError('Base URL is required');
            return;
        }
        const urlValidation = validateBaseURL(formData.baseURL);
        if (!urlValidation.isValid) {
            setLocalError(urlValidation.error || 'Invalid Base URL');
            return;
        }
        setLocalError(null);
        onSubmit();
    };

    return (
        <div className="space-y-2">
            <Input
                value={formData.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder="Model name *"
                className="h-8 text-xs"
            />
            <Input
                value={formData.baseURL}
                onChange={(e) => {
                    onChange({ baseURL: e.target.value });
                    setLocalError(null);
                }}
                placeholder="Base URL * (e.g., http://localhost:11434/v1)"
                className={cn('h-8 text-xs', localError && 'border-red-500')}
            />
            {localError && <div className="text-[10px] text-red-500">{localError}</div>}
            <div className="grid grid-cols-2 gap-2">
                <Input
                    value={formData.maxInputTokens}
                    onChange={(e) => onChange({ maxInputTokens: e.target.value })}
                    placeholder="Max input tokens (default: 128k)"
                    type="number"
                    className="h-8 text-xs"
                />
                <Input
                    value={formData.maxOutputTokens}
                    onChange={(e) => onChange({ maxOutputTokens: e.target.value })}
                    placeholder="Max output tokens (optional)"
                    type="number"
                    className="h-8 text-xs"
                />
            </div>
            <Button
                onClick={handleSubmit}
                size="sm"
                className="w-full h-8 text-xs"
                disabled={isSubmitting || !formData.name.trim() || !formData.baseURL.trim()}
            >
                <Plus className="h-3 w-3 mr-1" />
                Add Model
            </Button>
        </div>
    );
}

/**
 * OpenRouter model form with real-time validation
 */
export function OpenRouterForm({ formData, onChange, onSubmit, isSubmitting }: BaseFormProps) {
    const { mutateAsync: validateOpenRouterModel } = useValidateOpenRouterModel();
    const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [validation, setValidation] = useState<{
        status: 'idle' | 'validating' | 'valid' | 'invalid';
        error?: string;
    }>({ status: 'idle' });

    // Debounced validation
    useEffect(() => {
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
    }, [formData.name, validateOpenRouterModel]);

    const handleSubmit = () => {
        if (validation.status !== 'valid') {
            return;
        }
        onSubmit();
    };

    const isValid = validation.status === 'valid';
    const isInvalid = validation.status === 'invalid';
    const isValidating = validation.status === 'validating';

    return (
        <div className="space-y-2">
            <div className="relative">
                <Input
                    value={formData.name}
                    onChange={(e) => onChange({ name: e.target.value })}
                    placeholder="Model ID * (e.g., anthropic/claude-3.5-sonnet)"
                    className={cn(
                        'h-8 text-xs pr-8',
                        isValid && 'border-green-500 focus-visible:ring-green-500',
                        isInvalid && 'border-red-500 focus-visible:ring-red-500'
                    )}
                />
                {/* Validation status indicator */}
                {formData.name.trim() && (
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
            {isInvalid && validation.error && (
                <div className="text-[10px] text-red-500">{validation.error}</div>
            )}
            <Input
                value={formData.displayName}
                onChange={(e) => onChange({ displayName: e.target.value })}
                placeholder="Display name (optional)"
                className="h-8 text-xs"
            />
            <Button
                onClick={handleSubmit}
                size="sm"
                className="w-full h-8 text-xs"
                disabled={isSubmitting || !isValid}
            >
                <Plus className="h-3 w-3 mr-1" />
                Add Model
            </Button>
        </div>
    );
}
