import React, { useState } from 'react';
import { AlertCircle, ChevronRight, CheckCircle2, XCircle, Terminal, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import type { ApprovalEvent } from './ApprovalRequestHandler';
import type { JSONSchema7 } from 'json-schema';
import { ApprovalType } from '@dexto/core';

interface ApprovalTimelineProps {
    approval: ApprovalEvent;
    onApprove: (formData?: Record<string, unknown>, rememberChoice?: boolean) => void;
    onDeny: () => void;
}

export function ApprovalTimeline({ approval, onApprove, onDeny }: ApprovalTimelineProps) {
    const [expanded, setExpanded] = useState(false);
    const [formData, setFormData] = useState<Record<string, unknown>>({});
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});
    const [rememberChoice, setRememberChoice] = useState(false);

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

    const handleApprove = () => {
        if (approval.type === ApprovalType.ELICITATION) {
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

    // Generate display info based on approval type
    const getDisplayInfo = () => {
        let summary = '';
        let displayName = '';
        let source = '';

        if (approval.type === ApprovalType.COMMAND_CONFIRMATION) {
            displayName = 'bash';
            summary = 'Command requires approval';
            source = 'system';
        } else if (approval.type === ApprovalType.TOOL_APPROVAL) {
            const toolName = approval.metadata.toolName;
            if (toolName.startsWith('mcp--')) {
                displayName = toolName.substring(5);
                source = 'mcp';
            } else {
                displayName = toolName;
            }
            summary = `Tool requires approval`;
        } else if (approval.type === ApprovalType.ELICITATION) {
            displayName = approval.metadata.serverName || 'Agent';
            summary = 'Information requested';
            source = 'input';
        }

        return { summary, displayName, source };
    };

    const { summary, displayName, source } = getDisplayInfo();

    const renderFormField = (fieldName: string, fieldSchema: JSONSchema7, isRequired: boolean) => {
        const fieldType = fieldSchema.type || 'string';
        const fieldValue = formData[fieldName];
        const hasError = !!formErrors[fieldName];
        const label = fieldSchema.title || fieldName;

        if (fieldType === 'boolean') {
            return (
                <div key={fieldName} className="space-y-1">
                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id={fieldName}
                            checked={fieldValue === true}
                            onCheckedChange={(checked) =>
                                updateFormField(fieldName, checked === true)
                            }
                        />
                        <label htmlFor={fieldName} className="text-xs font-medium">
                            {label}
                            {isRequired && <span className="text-red-500 ml-1">*</span>}
                        </label>
                    </div>
                    {fieldSchema.description && (
                        <p className="text-[10px] text-muted-foreground/70 ml-6">
                            {fieldSchema.description}
                        </p>
                    )}
                </div>
            );
        }

        if (fieldType === 'number' || fieldType === 'integer') {
            return (
                <div key={fieldName} className="space-y-1">
                    <label htmlFor={fieldName} className="text-xs font-medium block">
                        {label}
                        {isRequired && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    {fieldSchema.description && (
                        <p className="text-[10px] text-muted-foreground/70">
                            {fieldSchema.description}
                        </p>
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
                        className={cn(
                            'w-full px-2 py-1.5 border rounded text-xs bg-background',
                            hasError ? 'border-red-500' : 'border-border'
                        )}
                        placeholder={isRequired ? 'Required' : 'Optional'}
                    />
                    {hasError && (
                        <p className="text-[10px] text-red-500">{formErrors[fieldName]}</p>
                    )}
                </div>
            );
        }

        if (fieldSchema.enum && Array.isArray(fieldSchema.enum)) {
            return (
                <div key={fieldName} className="space-y-1">
                    <label htmlFor={fieldName} className="text-xs font-medium block">
                        {label}
                        {isRequired && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    {fieldSchema.description && (
                        <p className="text-[10px] text-muted-foreground/70">
                            {fieldSchema.description}
                        </p>
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
                        className={cn(
                            'w-full px-2 py-1.5 border rounded text-xs bg-background',
                            hasError ? 'border-red-500' : 'border-border'
                        )}
                    >
                        <option value="">Select...</option>
                        {(fieldSchema.enum as unknown[])?.map((option) => (
                            <option key={String(option)} value={String(option)}>
                                {String(option)}
                            </option>
                        ))}
                    </select>
                    {hasError && (
                        <p className="text-[10px] text-red-500">{formErrors[fieldName]}</p>
                    )}
                </div>
            );
        }

        return (
            <div key={fieldName} className="space-y-1">
                <label htmlFor={fieldName} className="text-xs font-medium block">
                    {label}
                    {isRequired && <span className="text-red-500 ml-1">*</span>}
                </label>
                {fieldSchema.description && (
                    <p className="text-[10px] text-muted-foreground/70">
                        {fieldSchema.description}
                    </p>
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
                    className={cn(
                        'w-full px-2 py-1.5 border rounded text-xs bg-background',
                        hasError ? 'border-red-500' : 'border-border'
                    )}
                    placeholder={isRequired ? 'Required' : 'Optional'}
                />
                {hasError && <p className="text-[10px] text-red-500">{formErrors[fieldName]}</p>}
            </div>
        );
    };

    return (
        <div className="flex gap-2.5 animate-slide-up my-1">
            {/* Timeline column */}
            <div className="flex flex-col items-center">
                {/* Status indicator with pulse */}
                <div className="flex-shrink-0 relative">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                    <span className="absolute inset-0 h-3.5 w-3.5 rounded-full bg-amber-500/30 animate-ping" />
                </div>
                {/* Vertical line */}
                <div className="w-px flex-1 min-h-[8px] bg-amber-500/30" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pb-1">
                {/* Summary line */}
                <div className="space-y-1.5">
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="w-full flex items-center gap-1.5 text-left group"
                    >
                        <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                            {summary}
                        </span>

                        {source && (
                            <span className="text-[10px] text-muted-foreground/40">[{source}]</span>
                        )}

                        <ChevronRight
                            className={cn(
                                'h-2.5 w-2.5 text-muted-foreground/40 transition-transform flex-shrink-0',
                                expanded && 'rotate-90'
                            )}
                        />

                        <span className="text-[10px] text-amber-600/60 dark:text-amber-400/60">
                            needs approval
                        </span>
                    </button>

                    {/* Tool/command name */}
                    <div className="text-[10px] text-muted-foreground/35">{displayName}</div>

                    {/* Inline action buttons (when not expanded) */}
                    {!expanded && approval.type !== ApprovalType.ELICITATION && (
                        <div className="flex gap-1.5 mt-1.5">
                            <Button
                                onClick={handleApprove}
                                size="sm"
                                className="bg-green-600 hover:bg-green-700 text-white h-6 text-[11px] px-2.5"
                            >
                                Approve
                            </Button>
                            <Button
                                onClick={onDeny}
                                variant="outline"
                                size="sm"
                                className="h-6 text-[11px] px-2.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                            >
                                Reject
                            </Button>
                        </div>
                    )}

                    {/* For elicitation, always show expanded since form is required */}
                    {approval.type === ApprovalType.ELICITATION && !expanded && (
                        <button
                            onClick={() => setExpanded(true)}
                            className="text-[10px] text-amber-600 dark:text-amber-400 underline"
                        >
                            Click to provide input...
                        </button>
                    )}
                </div>

                {/* Expanded details */}
                {expanded && (
                    <div className="mt-2 space-y-3 animate-fade-in">
                        {/* Command confirmation */}
                        {approval.type === ApprovalType.COMMAND_CONFIRMATION && (
                            <>
                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                    <Terminal className="h-3 w-3" />
                                    <span>Command</span>
                                </div>
                                <pre className="bg-muted/30 rounded-md p-2 text-[10px] font-mono text-red-600 dark:text-red-400 whitespace-pre-wrap break-all">
                                    {approval.metadata.command}
                                </pre>
                                <div className="bg-amber-50 dark:bg-amber-900/20 p-2 rounded-md text-[10px] text-amber-800 dark:text-amber-200">
                                    This command may modify your system.
                                </div>
                            </>
                        )}

                        {/* Tool confirmation */}
                        {approval.type === ApprovalType.TOOL_APPROVAL && (
                            <>
                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                    <Wrench className="h-3 w-3" />
                                    <span>{approval.metadata.toolName}</span>
                                </div>
                                {approval.metadata.description && (
                                    <p className="text-xs text-foreground/70">
                                        {approval.metadata.description}
                                    </p>
                                )}
                                <div>
                                    <h4 className="text-[9px] font-semibold text-muted-foreground/60 uppercase mb-1">
                                        Arguments
                                    </h4>
                                    <div className="bg-muted/30 rounded-md p-1.5 space-y-0.5">
                                        {Object.entries(approval.metadata.args || {}).map(
                                            ([key, value]) => (
                                                <div key={key} className="flex gap-1.5 text-[10px]">
                                                    <span className="text-muted-foreground font-medium shrink-0">
                                                        {key}:
                                                    </span>
                                                    <span className="text-foreground/70 font-mono break-all">
                                                        {typeof value === 'string'
                                                            ? value
                                                            : typeof value === 'object'
                                                              ? JSON.stringify(value)
                                                              : String(value)}
                                                    </span>
                                                </div>
                                            )
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        id="remember"
                                        checked={rememberChoice}
                                        onCheckedChange={(checked) =>
                                            setRememberChoice(checked === true)
                                        }
                                    />
                                    <label
                                        htmlFor="remember"
                                        className="text-[10px] text-muted-foreground"
                                    >
                                        Remember for this session
                                    </label>
                                </div>
                            </>
                        )}

                        {/* Elicitation (form) */}
                        {approval.type === ApprovalType.ELICITATION && (
                            <>
                                <div className="bg-muted/30 p-2 rounded-md">
                                    <p className="text-xs font-medium break-words">
                                        {approval.metadata.prompt}
                                    </p>
                                </div>
                                <div className="space-y-3">
                                    {(() => {
                                        const { schema } = approval.metadata;
                                        if (
                                            !schema?.properties ||
                                            typeof schema.properties !== 'object'
                                        ) {
                                            return (
                                                <p className="text-xs text-red-600 dark:text-red-400">
                                                    Invalid form schema
                                                </p>
                                            );
                                        }

                                        const required = (schema.required as string[]) || [];
                                        const properties = schema.properties;

                                        return Object.entries(properties).map(
                                            ([fieldName, fieldSchema]) => {
                                                const isRequired = required.includes(fieldName);
                                                return renderFormField(
                                                    fieldName,
                                                    fieldSchema as JSONSchema7,
                                                    isRequired
                                                );
                                            }
                                        );
                                    })()}
                                </div>
                            </>
                        )}

                        {/* Action buttons (expanded view) */}
                        <div className="flex gap-1.5">
                            <Button
                                onClick={handleApprove}
                                size="sm"
                                className="flex-1 bg-green-600 hover:bg-green-700 text-white h-7 text-xs"
                            >
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                {approval.type === ApprovalType.ELICITATION ? 'Submit' : 'Approve'}
                            </Button>
                            <Button
                                onClick={onDeny}
                                size="sm"
                                variant="outline"
                                className="flex-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 h-7 text-xs"
                            >
                                <XCircle className="h-3 w-3 mr-1" />
                                {approval.type === ApprovalType.ELICITATION ? 'Decline' : 'Reject'}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
