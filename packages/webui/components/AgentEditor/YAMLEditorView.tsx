'use client';

import React from 'react';
import AgentConfigEditor from './AgentConfigEditor';
import ConfigValidationStatus from './ConfigValidationStatus';
import type { editor } from 'monaco-editor';

interface ValidationError {
    line?: number;
    column?: number;
    path?: string;
    message: string;
    code: string;
}

interface ValidationWarning {
    path: string;
    message: string;
    code: string;
}

interface YAMLEditorViewProps {
    value: string;
    onChange: (value: string) => void;
    onValidate?: (markers: editor.IMarker[]) => void;
    isValidating?: boolean;
    isValid?: boolean;
    errors?: ValidationError[];
    warnings?: ValidationWarning[];
    hasUnsavedChanges?: boolean;
}

/**
 * YAMLEditorView - Pure YAML editor with validation display
 *
 * This component is responsible for rendering the Monaco YAML editor
 * and the validation status bar. It doesn't handle loading/saving -
 * that's the parent's job.
 *
 * Reusable in both edit and create flows.
 */
export default function YAMLEditorView({
    value,
    onChange,
    onValidate,
    isValidating = false,
    isValid = true,
    errors = [],
    warnings = [],
    hasUnsavedChanges = false,
}: YAMLEditorViewProps) {
    return (
        <div className="flex flex-col h-full">
            {/* Editor */}
            <div className="flex-1 overflow-hidden">
                <AgentConfigEditor
                    value={value}
                    onChange={onChange}
                    onValidate={onValidate}
                    height="100%"
                />
            </div>

            {/* Validation Status */}
            <ConfigValidationStatus
                isValidating={isValidating}
                isValid={isValid}
                errors={errors}
                warnings={warnings}
                hasUnsavedChanges={hasUnsavedChanges}
            />
        </div>
    );
}
