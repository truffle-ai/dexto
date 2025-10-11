'use client';

import React, { useState } from 'react';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { AlertTriangle, Wrench } from 'lucide-react';

interface ApprovalEvent {
    approvalId: string;
    type: string;
    toolName?: string;
    args?: any;
    description?: string;
    timestamp: Date;
    sessionId?: string;
    metadata: Record<string, any>;
}

interface InlineApprovalCardProps {
    approval: ApprovalEvent;
    onApprove: (formData?: Record<string, any>, rememberChoice?: boolean) => void;
    onDeny: () => void;
}

export function InlineApprovalCard({ approval, onApprove, onDeny }: InlineApprovalCardProps) {
    const [formData, setFormData] = useState<Record<string, any>>({});
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});
    const [rememberChoice, setRememberChoice] = useState(false);

    const isElicitation = approval.type === 'elicitation';

    // Update form field value
    const updateFormField = (fieldName: string, value: any) => {
        setFormData(prev => ({ ...prev, [fieldName]: value }));
        if (formErrors[fieldName]) {
            setFormErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[fieldName];
                return newErrors;
            });
        }
    };

    // Render form field based on JSON Schema field type
    const renderFormField = (fieldName: string, fieldSchema: any, isRequired: boolean) => {
        const fieldType = fieldSchema.type || 'string';
        const fieldValue = formData[fieldName];
        const hasError = !!formErrors[fieldName];

        if (fieldType === 'boolean') {
            return (
                <div key={fieldName} className="space-y-2">
                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id={fieldName}
                            checked={fieldValue === true}
                            onCheckedChange={(checked) => updateFormField(fieldName, checked === true)}
                        />
                        <label htmlFor={fieldName} className="text-sm font-medium">
                            {fieldName}
                            {isRequired && <span className="text-red-500 ml-1">*</span>}
                        </label>
                    </div>
                    {fieldSchema.description && (
                        <p className="text-xs text-muted-foreground ml-6">{fieldSchema.description}</p>
                    )}
                </div>
            );
        }

        if (fieldType === 'number' || fieldType === 'integer') {
            return (
                <div key={fieldName} className="space-y-1">
                    <label htmlFor={fieldName} className="text-sm font-medium block">
                        {fieldName}
                        {isRequired && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    {fieldSchema.description && (
                        <p className="text-xs text-muted-foreground">{fieldSchema.description}</p>
                    )}
                    <input
                        id={fieldName}
                        type="number"
                        step={fieldType === 'integer' ? '1' : 'any'}
                        value={fieldValue ?? ''}
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
                        {fieldName}
                        {isRequired && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    {fieldSchema.description && (
                        <p className="text-xs text-muted-foreground">{fieldSchema.description}</p>
                    )}
                    <select
                        id={fieldName}
                        value={fieldValue ?? ''}
                        onChange={(e) => {
                            const selected = e.target.value;
                            if (selected === '') {
                                updateFormField(fieldName, undefined);
                                return;
                            }

                            const matched = fieldSchema.enum.find(
                                (option: any) => String(option) === selected
                            );
                            updateFormField(fieldName, matched ?? selected);
                        }}
                        className={`w-full px-3 py-2 border rounded-md text-sm bg-background ${
                            hasError ? 'border-red-500' : 'border-border'
                        }`}
                    >
                        <option value="">Select an option...</option>
                        {fieldSchema.enum.map((option: any) => (
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
                    {fieldName}
                    {isRequired && <span className="text-red-500 ml-1">*</span>}
                </label>
                {fieldSchema.description && (
                    <p className="text-xs text-muted-foreground">{fieldSchema.description}</p>
                )}
                <input
                    id={fieldName}
                    type="text"
                    value={fieldValue ?? ''}
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
        if (isElicitation) {
            // Validate form
            const schema = (approval.metadata as any).schema;
            const required = schema?.required || [];
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
                    {isElicitation ? 'Information Request' : 'Approval Required'}
                </span>
            </div>

            {/* Content */}
            {isElicitation ? (
                <div className="space-y-4 min-w-0">
                    <div className="bg-muted/50 p-3 rounded-md border border-border min-w-0">
                        <p className="text-sm font-medium mb-1 break-words">
                            {(approval.metadata as any).prompt}
                        </p>
                        <p className="text-xs text-muted-foreground break-words">
                            From: {(approval.metadata as any).serverName || 'Dexto Agent'}
                        </p>
                    </div>

                            <div>
                                {(() => {
                                    const schema = (approval.metadata as any).schema;
                                    if (!schema?.properties || typeof schema.properties !== 'object') {
                                        return (
                                            <p className="text-sm text-red-600 dark:text-red-400">
                                                Invalid form schema
                                            </p>
                                        );
                                    }

                                    const required = schema.required || [];
                                    const properties = schema.properties;

                                    return (
                                        <div className="space-y-4">
                                            {Object.entries(properties).map(([fieldName, fieldSchema]) => {
                                                const isRequired = required.includes(fieldName);
                                                return renderFormField(fieldName, fieldSchema, isRequired);
                                            })}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                                <Wrench className="h-4 w-4 flex-shrink-0" />
                                <span className="font-medium text-sm break-words min-w-0">Tool: {approval.toolName}</span>
                            </div>

                            {approval.description && (
                                <p className="text-sm break-words">{approval.description}</p>
                            )}

                            <div className="min-w-0">
                                <span className="font-medium text-sm block mb-2">Arguments:</span>
                                <pre className="bg-muted/50 p-3 rounded-md text-xs overflow-auto max-h-40 border border-border break-words whitespace-pre-wrap max-w-full">
                                    {JSON.stringify(approval.args, null, 2)}
                                </pre>
                            </div>

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
                    )}

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-3 border-t border-border">
                <Button
                    variant="outline"
                    onClick={onDeny}
                    size="sm"
                >
                    {isElicitation ? 'Decline' : 'Deny'}
                </Button>
                <Button
                    onClick={handleApprove}
                    size="sm"
                >
                    {isElicitation ? 'Submit' : 'Approve'}
                </Button>
            </div>
        </div>
    );
}
