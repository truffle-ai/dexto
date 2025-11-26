/**
 * ConfigValidationStatus
 *
 * Displays real-time validation status for agent configuration editing.
 * Shows validation state (validating/valid/invalid), error count, warnings,
 * and detailed error/warning messages with line numbers. Provides visual
 * feedback during configuration editing to help users fix issues before saving.
 */

import React from 'react';
import { AlertCircle, CheckCircle, AlertTriangle } from 'lucide-react';
import type { ValidationError, ValidationWarning } from '../hooks/useAgentConfig';

interface ConfigValidationStatusProps {
    isValidating: boolean;
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    hasUnsavedChanges: boolean;
}

export default function ConfigValidationStatus({
    isValidating,
    isValid,
    errors,
    warnings,
    hasUnsavedChanges,
}: ConfigValidationStatusProps) {
    return (
        <div className="border-t border-border bg-background px-4 py-3">
            <div className="flex items-center justify-between gap-4">
                {/* Status indicator */}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isValidating ? (
                        <>
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                            <span className="text-sm text-muted-foreground">Validating...</span>
                        </>
                    ) : isValid ? (
                        <>
                            <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                            <span className="text-sm text-muted-foreground">
                                Valid configuration
                                {hasUnsavedChanges && ' (unsaved changes)'}
                            </span>
                        </>
                    ) : (
                        <>
                            <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                            <span className="text-sm text-destructive">
                                {errors.length} {errors.length === 1 ? 'error' : 'errors'}
                            </span>
                        </>
                    )}
                </div>

                {/* Warnings indicator */}
                {warnings.length > 0 && (
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                        <span className="text-sm text-yellow-500">
                            {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
                        </span>
                    </div>
                )}
            </div>

            {/* Error list */}
            {errors.length > 0 && (
                <div className="mt-3 space-y-2 max-h-32 overflow-y-auto">
                    {errors.map((error, idx) => (
                        <div
                            key={idx}
                            className="text-xs bg-destructive/10 text-destructive rounded px-2 py-1.5 flex items-start gap-2"
                        >
                            <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                                {error.path && <span className="font-medium">{error.path}: </span>}
                                {error.message}
                                {error.line && (
                                    <span className="text-muted-foreground ml-1">
                                        (line {error.line}
                                        {error.column && `:${error.column}`})
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Warning list */}
            {warnings.length > 0 && errors.length === 0 && (
                <div className="mt-3 space-y-2 max-h-32 overflow-y-auto">
                    {warnings.map((warning, idx) => (
                        <div
                            key={idx}
                            className="text-xs bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 rounded px-2 py-1.5 flex items-start gap-2"
                        >
                            <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                                <span className="font-medium">{warning.path}: </span>
                                {warning.message}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
