'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Checkbox } from './ui/checkbox';
import { Badge } from './ui/badge';
import { DialogFooter } from './ui/dialog';
import { Clock, Server, AlertCircle } from 'lucide-react';

// JSON Schema interfaces
interface JSONSchema {
    type?: string;
    properties?: Record<string, JSONSchemaProperty>;
    required?: string[];
    description?: string;
}

interface JSONSchemaProperty {
    type?: string;
    description?: string;
    enum?: unknown[];
    default?: unknown;
}

interface ElicitationEvent {
    executionId: string;
    message: string;
    requestedSchema: JSONSchema;
    timestamp: Date;
    sessionId?: string;
    serverName?: string;
}

interface ElicitationFormProps {
    event: ElicitationEvent;
    onAccept: (data: Record<string, unknown>) => void;
    onDecline: () => void;
    onCancel: () => void;
}

interface FormField {
    key: string;
    type: string;
    required: boolean;
    description?: string;
    enum?: unknown[];
    default?: unknown;
}

/**
 * Dynamic form component for MCP elicitation requests
 * Generates form fields based on the provided JSON schema
 */
export function ElicitationForm({ event, onAccept, onDecline, onCancel }: ElicitationFormProps) {
    const [formData, setFormData] = useState<Record<string, unknown>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Parse the schema to extract form fields
    const parseSchema = useCallback((schema: JSONSchema): FormField[] => {
        const fields: FormField[] = [];
        
        if (schema.type === 'object' && schema.properties) {
            const required = schema.required || [];
            
            Object.entries(schema.properties).forEach(([key, prop]: [string, JSONSchemaProperty]) => {
                fields.push({
                    key,
                    type: prop.type || 'string',
                    required: required.includes(key),
                    description: prop.description,
                    enum: prop.enum,
                    default: prop.default,
                });
            });
        }
        
        return fields;
    }, []);

    const fields = useMemo(() => parseSchema(event.requestedSchema), [event.requestedSchema]);

    // Initialize form data with defaults
    React.useEffect(() => {
        const initialData: Record<string, unknown> = {};
        fields.forEach(field => {
            if (field.default !== undefined) {
                initialData[field.key] = field.default;
            }
        });
        setFormData(initialData);
        setErrors({});
    }, [fields]);

    // Update form field value
    const updateField = useCallback((key: string, value: unknown) => {
        setFormData(prev => ({ ...prev, [key]: value }));
        // Clear error when user starts typing
        setErrors(prev => {
            if (prev[key]) {
                const { [key]: _, ...rest } = prev;
                return rest;
            }
            return prev;
        });
    }, []);

    // Validate form data against schema
    const validateForm = useCallback((): boolean => {
        const newErrors: Record<string, string> = {};
        
        fields.forEach(field => {
            const value = formData[field.key];
            
            // Required field validation
            if (field.required && (value === undefined || value === '' || value === null)) {
                newErrors[field.key] = 'This field is required';
                return;
            }
            
            // Type validation
            if (value !== undefined && value !== '') {
                switch (field.type) {
                    case 'number':
                        if (isNaN(Number(value))) {
                            newErrors[field.key] = 'Must be a valid number';
                        }
                        break;
                    case 'integer':
                        if (!Number.isInteger(Number(value))) {
                            newErrors[field.key] = 'Must be a valid integer';
                        }
                        break;
                    case 'boolean':
                        // Boolean fields are handled by checkbox, no validation needed
                        break;
                    case 'string':
                    default:
                        // String validation - could add pattern matching here
                        break;
                }
            }
            
            // Enum validation
            if (field.enum && value && !field.enum.includes(value)) {
                newErrors[field.key] = `Must be one of: ${field.enum.join(', ')}`;
            }
        });
        
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }, [fields, formData]);

    // Handle form submission
    const handleAccept = useCallback(async () => {
        if (!validateForm()) return;
        
        setIsSubmitting(true);
        
        // Convert form data to appropriate types
        const processedData: Record<string, unknown> = {};
        fields.forEach(field => {
            const value = formData[field.key];
            if (value !== undefined && value !== '') {
                switch (field.type) {
                    case 'number':
                    case 'integer':
                        processedData[field.key] = Number(value);
                        break;
                    case 'boolean':
                        processedData[field.key] = Boolean(value);
                        break;
                    default:
                        processedData[field.key] = value;
                        break;
                }
            }
        });
        
        onAccept(processedData);
    }, [validateForm, formData, fields, onAccept]);

    // Render form field based on type
    const renderField = (field: FormField) => {
        const value = formData[field.key] ?? '';
        const stringValue = String(value);
        const error = errors[field.key];
        
        const fieldId = `field-${field.key}`;
        
        return (
            <div key={`field-${field.key}`} className="space-y-2">
                <Label htmlFor={fieldId} className="flex items-center gap-2">
                    {field.key}
                    {field.required && <span className="text-red-500">*</span>}
                    {field.type !== 'string' && (
                        <Badge variant="outline" className="text-xs">
                            {field.type}
                        </Badge>
                    )}
                </Label>
                
                {field.description && (
                    <p className="text-sm text-muted-foreground">{field.description}</p>
                )}
                
                {field.enum ? (
                    <select
                        id={fieldId}
                        value={stringValue}
                        onChange={(e) => updateField(field.key, e.target.value)}
                        className="w-full p-2 border rounded-md"
                        required={field.required}
                    >
                        <option value="">Select an option</option>
                        {field.enum.map(option => (
                            <option key={String(option)} value={String(option)}>{String(option)}</option>
                        ))}
                    </select>
                ) : field.type === 'boolean' ? (
                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id={fieldId}
                            checked={Boolean(value)}
                            onCheckedChange={(checked) => updateField(field.key, checked)}
                        />
                        <Label htmlFor={fieldId} className="text-sm">
                            {field.description || field.key}
                        </Label>
                    </div>
                ) : field.type === 'number' || field.type === 'integer' ? (
                    <Input
                        id={fieldId}
                        type="number"
                        value={stringValue}
                        onChange={(e) => updateField(field.key, e.target.value)}
                        placeholder={`Enter ${field.type}`}
                        step={field.type === 'integer' ? 1 : 'any'}
                        required={field.required}
                    />
                ) : (
                    <div>
                        {field.description && field.description.length > 100 ? (
                            <Textarea
                                id={fieldId}
                                value={stringValue}
                                onChange={(e) => updateField(field.key, e.target.value)}
                                placeholder="Enter your response"
                                required={field.required}
                                rows={3}
                            />
                        ) : (
                            <Input
                                id={fieldId}
                                value={stringValue}
                                onChange={(e) => updateField(field.key, e.target.value)}
                                placeholder="Enter your response"
                                required={field.required}
                            />
                        )}
                    </div>
                )}
                
                {error && (
                    <div className="flex items-center gap-1 text-sm text-red-600">
                        <AlertCircle className="h-4 w-4" />
                        {error}
                    </div>
                )}
            </div>
        );
    };

    return (
        <>
            <div className="space-y-4">
                {/* Server info */}
                {event.serverName && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Server className="h-4 w-4" />
                        <span>Requested by: {event.serverName}</span>
                    </div>
                )}
                
                {/* Elicitation message */}
                <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                    <h3 className="font-medium text-blue-900 mb-2">Information Request</h3>
                    <p className="text-blue-800">{event.message}</p>
                </div>
                
                {/* Timestamp */}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>Requested at: {event.timestamp.toLocaleString()}</span>
                </div>
                
                {/* Form fields */}
                {fields.length > 0 ? (
                    <div className="space-y-4 border-t pt-4">
                        <h4 className="font-medium">Please provide the following information:</h4>
                        {fields.map(renderField)}
                    </div>
                ) : (
                    <div className="text-center text-muted-foreground py-4">
                        No specific data requested - you can accept or decline this request.
                    </div>
                )}
                
                {/* Security notice */}
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                    <p className="text-sm text-amber-800">
                        <strong>Privacy Notice:</strong> Only provide information you're comfortable sharing. 
                        The requesting server will receive any data you submit.
                    </p>
                </div>
            </div>
            
            <DialogFooter className="gap-2 mt-6 pt-4 border-t">
                <Button 
                    variant="outline" 
                    onClick={onCancel}
                    disabled={isSubmitting}
                    className="bg-gray-50 hover:bg-gray-100"
                >
                    Cancel
                </Button>
                <Button 
                    variant="outline" 
                    onClick={onDecline}
                    disabled={isSubmitting}
                    className="bg-red-50 hover:bg-red-100 text-red-700 border-red-200"
                >
                    Decline
                </Button>
                <Button 
                    onClick={handleAccept}
                    disabled={isSubmitting}
                    className="bg-green-600 hover:bg-green-700"
                >
                    {isSubmitting ? 'Submitting...' : 'Accept & Send'}
                </Button>
            </DialogFooter>
        </>
    );
}