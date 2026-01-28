/**
 * Shared types for the CustomModelWizard component architecture.
 */

import type { CustomModel, CustomModelProvider } from '@dexto/agent-management';
import type { Key } from '../../../hooks/useInputOrchestrator.js';

/**
 * A single step in the wizard flow.
 */
export interface WizardStep {
    field: string;
    label: string;
    placeholder: string;
    required: boolean;
    validate?: (value: string) => string | null;
    /**
     * Optional condition to determine if this step should be shown.
     * Takes the current accumulated values and returns true if the step should be shown.
     * If omitted, the step is always shown.
     */
    condition?: (values: Record<string, string>) => boolean;
}

/**
 * Props passed to each provider-specific wizard component.
 */
export interface ProviderWizardProps {
    /** Current accumulated values from all steps */
    values: Record<string, string>;
    /** Current step index within the provider's steps */
    currentStep: number;
    /** Current text input value */
    currentInput: string;
    /** Validation error message (if any) */
    error: string | null;
    /** Whether async validation is in progress */
    isValidating: boolean;
    /** Whether the model is being saved */
    isSaving: boolean;
    /** Whether we're editing an existing model */
    isEditing: boolean;
}

/**
 * Handle returned by provider components for input handling.
 */
export interface ProviderWizardHandle {
    /** Handle keyboard input. Returns true if handled. */
    handleInput: (input: string, key: Key) => boolean;
    /** Get the steps for this provider */
    getSteps: () => WizardStep[];
    /** Get current step config */
    getCurrentStepConfig: () => WizardStep | undefined;
}

/**
 * Configuration for a custom model provider.
 */
export interface ProviderConfig {
    /** Display name shown in provider selector */
    displayName: string;
    /** Short description of the provider */
    description: string;
    /** Wizard steps for this provider */
    steps: WizardStep[];
    /** Build a CustomModel from accumulated values */
    buildModel: (values: Record<string, string>, provider: CustomModelProvider) => CustomModel;
    /** Optional async validation for specific fields */
    asyncValidation?: {
        field: string;
        validate: (value: string) => Promise<string | null>;
    };
    /** Whether this provider needs a setup info banner */
    setupInfo?: {
        title: string;
        description: string;
        docsUrl?: string;
    };
}

/**
 * Common validation functions
 */
export const validators = {
    required: (label: string) => (v: string) => (v.trim() ? null : `${label} is required`),

    url: (v: string) => {
        if (!v.trim()) return 'URL is required';
        try {
            const url = new URL(v);
            if (!['http:', 'https:'].includes(url.protocol)) {
                return 'URL must use http:// or https://';
            }
            return null;
        } catch {
            return 'Invalid URL format';
        }
    },

    positiveNumber: (v: string) => {
        if (!v.trim()) return null; // Optional field
        const num = parseInt(v, 10);
        if (isNaN(num) || num <= 0) return 'Must be a positive number';
        return null;
    },

    slashFormat: (v: string) => {
        if (!v.trim()) return 'Model ID is required';
        if (!v.includes('/')) return 'Must use format: provider/model-name';
        return null;
    },
};
