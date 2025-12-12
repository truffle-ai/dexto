import React, { useState } from 'react';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { AlertTriangle, Wrench } from 'lucide-react';
import type { ApprovalEvent } from './ToolConfirmationHandler';
import type { JSONSchema7 } from 'json-schema';
import { ApprovalType } from '@dexto/core';

interface InlineApprovalCardProps {
    approval: ApprovalEvent;
    onApprove: (formData?: Record<string, unknown>, rememberChoice?: boolean) => void;
    onDeny: () => void;
}

export function InlineApprovalCard({ approval, onApprove, onDeny }: InlineApprovalCardProps) {
    const [formData, setFormData] = useState<Record<string, unknown>>({});
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});
    const [rememberChoice, setRememberChoice] = useState(false);

    // Update form field value
    const updateFormField = (fieldName: string, value: unknown) => {
        setFormData((prev) => ({ ...prev, [fieldName]: value }));
        if (formErrors[fieldName]) {
            setFormErrors((prev) => {
                const newErrors = { ...prev };
                delete newErrors[fieldName];
                return newErrors;
            });
        }
    };

    // Render form field based on JSON Schema field type
    const renderFormField = (fieldName: string, fieldSchema: JSONSchema7, isRequired: boolean) => {
        const fieldType = fieldSchema.type || 'string';
        const fieldValue = formData[fieldName];
        const hasError = !!formErrors[fieldName];
        // Use title if available, fallback to fieldName
        const label = fieldSchema.title || fieldName;

        if (fieldType === 'boolean') {
            return (
                <div key={fieldName} className="space-y-2">
                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id={fieldName}
                            checked={fieldValue === true}
                            onCheckedChange={(checked) =>
                                updateFormField(fieldName, checked === true)
                            }
                        />
                        <label htmlFor={fieldName} className="text-sm font-medium">
                            {label}
                            {isRequired && <span className="text-red-500 ml-1">*</span>}
                        </label>
                    </div>
                    {fieldSchema.description && (
                        <p className="text-xs text-muted-foreground ml-6">
                            {fieldSchema.description}
                        </p>
                    )}
                </div>
            );
        }

        if (fieldType === 'number' || fieldType === 'integer') {
            return (
                <div key={fieldName} className="space-y-1">
                    <label htmlFor={fieldName} className="text-sm font-medium block">
                        {label}
                        {isRequired && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    {fieldSchema.description && (
                        <p className="text-xs text-muted-foreground">{fieldSchema.description}</p>
                    )}
                    <input
                        id={fieldName}
                        type="number"
                        step={fieldType === 'integer' ? '1' : 'any'}
                        value={typeof fieldValue === 'number' ? fieldValue : ''}
                        onChange={(e) => {
                            const raw = e.target.value;
                            const nextValue = raw === '' ? undefined : Number(raw);
                            updateFormField(fieldName, nextValue);
                        }}
                        className={`w-full px-3 py-2 border rounded-md text-sm bg-background ${
                            hasError ? 'border-red-500' : 'border-border'
                        }`}
                        placeholder={isRequired ? 'Required' : 'Optional'}
                    />
                    {hasError && <p className="text-xs text-red-500">{formErrors[fieldName]}</p>}
                </div>
            );
        }

        if (fieldSchema.enum && Array.isArray(fieldSchema.enum)) {
            return (
                <div key={fieldName} className="space-y-1">
                    <label htmlFor={fieldName} className="text-sm font-medium block">
                        {label}
                        {isRequired && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    {fieldSchema.description && (
                        <p className="text-xs text-muted-foreground">{fieldSchema.description}</p>
                    )}
                    <select
                        id={fieldName}
                        value={
                            fieldValue !== undefined && fieldValue !== null
                                ? String(fieldValue)
                                : ''
                        }
                        onChange={(e) => {
                            const selected = e.target.value;
                            if (selected === '') {
                                updateFormField(fieldName, undefined);
                                return;
                            }

                            const matched = (fieldSchema.enum as unknown[])?.find(
                                (option) => String(option) === selected
                            );
                            updateFormField(fieldName, matched ?? selected);
                        }}
                        className={`w-full px-3 py-2 border rounded-md text-sm bg-background ${
                            hasError ? 'border-red-500' : 'border-border'
                        }`}
                    >
                        <option value="">Select an option...</option>
                        {(fieldSchema.enum as unknown[])?.map((option) => (
                            <option key={String(option)} value={String(option)}>
                                {String(option)}
                            </option>
                        ))}
                    </select>
                    {hasError && <p className="text-xs text-red-500">{formErrors[fieldName]}</p>}
                </div>
            );
        }

        // Default to string input
        return (
            <div key={fieldName} className="space-y-1">
                <label htmlFor={fieldName} className="text-sm font-medium block">
                    {label}
                    {isRequired && <span className="text-red-500 ml-1">*</span>}
                </label>
                {fieldSchema.description && (
                    <p className="text-xs text-muted-foreground">{fieldSchema.description}</p>
                )}
                <input
                    id={fieldName}
                    type="text"
                    value={
                        fieldValue !== undefined &&
                        fieldValue !== null &&
                        typeof fieldValue !== 'object'
                            ? String(fieldValue)
                            : ''
                    }
                    onChange={(e) => updateFormField(fieldName, e.target.value)}
                    className={`w-full px-3 py-2 border rounded-md text-sm bg-background ${
                        hasError ? 'border-red-500' : 'border-border'
                    }`}
                    placeholder={isRequired ? 'Required' : 'Optional'}
                />
                {hasError && <p className="text-xs text-red-500">{formErrors[fieldName]}</p>}
            </div>
        );
    };

    const handleApprove = () => {
        if (approval.type === ApprovalType.ELICITATION) {
            // Validate form - metadata is typed as ElicitationMetadata after type check
            const { schema } = approval.metadata;
            const required = (schema.required as string[]) || [];
            const errors: Record<string, string> = {};

            for (const fieldName of required) {
                const value = formData[fieldName];
                const isEmptyString = typeof value === 'string' && value.trim() === '';
                if (value === undefined || value === null || isEmptyString) {
                    errors[fieldName] = 'This field is required';
                }
            }

            if (Object.keys(errors).length > 0) {
                setFormErrors(errors);
                return;
            }

            onApprove(formData);
        } else {
            onApprove(undefined, rememberChoice);
        }
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-medium text-sm">
                    {approval.type === ApprovalType.ELICITATION
                        ? 'Information Request'
                        : 'Approval Required'}
                </span>
            </div>

            {/* Content */}
            {approval.type === ApprovalType.COMMAND_CONFIRMATION ? (
                <div className="space-y-3 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <Wrench className="h-4 w-4 flex-shrink-0" />
                        <span className="font-medium text-sm break-words min-w-0">
                            Tool: {approval.metadata.toolName}
                        </span>
                    </div>

                    <div className="min-w-0">
                        <span className="font-medium text-sm block mb-2">Command:</span>
                        <pre className="bg-muted/50 p-3 rounded-md text-xs overflow-auto max-h-40 border border-border break-words whitespace-pre-wrap max-w-full text-red-600 dark:text-red-400">
                            {approval.metadata.command}
                        </pre>
                    </div>

                    {approval.metadata.originalCommand &&
                        approval.metadata.originalCommand !== approval.metadata.command && (
                            <div className="min-w-0">
                                <span className="text-xs text-muted-foreground">
                                    Original: {approval.metadata.originalCommand}
                                </span>
                            </div>
                        )}

                    <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-md border border-yellow-200 dark:border-yellow-800">
                        <p className="text-xs text-yellow-800 dark:text-yellow-200">
                            This command requires approval because it may modify your system.
                        </p>
                    </div>
                </div>
            ) : approval.type === ApprovalType.ELICITATION ? (
                <div className="space-y-4 min-w-0">
                    <div className="bg-muted/50 p-3 rounded-md border border-border min-w-0">
                        <p className="text-sm font-medium mb-1 break-words">
                            {approval.metadata.prompt}
                        </p>
                        <p className="text-xs text-muted-foreground break-words">
                            From: {approval.metadata.serverName || 'Dexto Agent'}
                        </p>
                    </div>

                    <div>
                        {(() => {
                            const { schema } = approval.metadata;
                            if (!schema?.properties || typeof schema.properties !== 'object') {
                                return (
                                    <p className="text-sm text-red-600 dark:text-red-400">
                                        Invalid form schema
                                    </p>
                                );
                            }

                            const required = (schema.required as string[]) || [];
                            const properties = schema.properties;

                            return (
                                <div className="space-y-4">
                                    {Object.entries(properties).map(([fieldName, fieldSchema]) => {
                                        const isRequired = required.includes(fieldName);
                                        return renderFormField(
                                            fieldName,
                                            fieldSchema as JSONSchema7,
                                            isRequired
                                        );
                                    })}
                                </div>
                            );
                        })()}
                    </div>
                </div>
            ) : approval.type === ApprovalType.TOOL_CONFIRMATION ? (
                <div className="space-y-3 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <Wrench className="h-4 w-4 flex-shrink-0" />
                        <span className="font-medium text-sm break-words min-w-0">
                            Tool: {approval.metadata.toolName}
                        </span>
                    </div>

                    {approval.metadata.description && (
                        <p className="text-sm break-words">{approval.metadata.description}</p>
                    )}

                    <div className="min-w-0">
                        <span className="font-medium text-sm block mb-2">Arguments:</span>
                        <pre className="bg-muted/50 p-3 rounded-md text-xs overflow-auto max-h-40 border border-border break-words whitespace-pre-wrap max-w-full">
                            {JSON.stringify(approval.metadata.args, null, 2)}
                        </pre>
                    </div>

                    {/* Only show "Remember choice" for tool confirmations, not command confirmations */}
                    <div className="flex items-center space-x-2 pt-2">
                        <Checkbox
                            id="remember"
                            checked={rememberChoice}
                            onCheckedChange={(checked) => setRememberChoice(checked === true)}
                        />
                        <label htmlFor="remember" className="text-sm">
                            Remember this choice for this session
                        </label>
                    </div>
                </div>
            ) : null}

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-3 border-t border-border">
                <Button variant="outline" onClick={onDeny} size="sm">
                    {approval.type === ApprovalType.ELICITATION ? 'Decline' : 'Deny'}
                </Button>
                <Button onClick={handleApprove} size="sm">
                    {approval.type === ApprovalType.ELICITATION ? 'Submit' : 'Approve'}
                </Button>
            </div>
        </div>
    );
}
