import React, { ChangeEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Copy, Share2, Zap } from 'lucide-react';
import type { McpTool } from '@/components/hooks/useServers';

// Infer the property schema type from the tool's input schema
type JsonSchemaProperty = NonNullable<NonNullable<McpTool['inputSchema']>['properties']>[string];

function isJsonSchemaProperty(value: unknown): value is JsonSchemaProperty {
    if (typeof value !== 'object' || value === null) return false;
    const record: { type?: unknown; enum?: unknown } = value;
    const propType = record['type'];
    if (
        propType !== undefined &&
        propType !== 'string' &&
        propType !== 'number' &&
        propType !== 'integer' &&
        propType !== 'boolean' &&
        propType !== 'object' &&
        propType !== 'array'
    ) {
        return false;
    }
    const enumValues = record['enum'];
    if (enumValues !== undefined && !Array.isArray(enumValues)) {
        return false;
    }
    return true;
}

interface ToolInputFormProps {
    tool: McpTool;
    inputs: Record<string, any>;
    errors: Record<string, string>;
    isLoading: boolean;
    onInputChange: (
        name: string,
        value: any,
        type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'
    ) => void;
    onSubmit: () => void;
    onCopyConfig?: () => void;
    onShareConfig?: () => void;
}

interface ToolTemplate {
    name: string;
    description: string;
    apply: (tool: McpTool) => Record<string, any>;
}

const toolTemplates: ToolTemplate[] = [
    {
        name: 'Quick Test',
        description: 'Fill with test values',
        apply: (tool: McpTool) => {
            const defaults: Record<string, any> = {};
            if (tool.inputSchema?.properties) {
                Object.entries(tool.inputSchema.properties).forEach(
                    ([key, prop]: [string, any]) => {
                        if (prop.type === 'string') defaults[key] = `test-${key}`;
                        else if (prop.type === 'number') defaults[key] = 42;
                        else if (prop.type === 'boolean') defaults[key] = true;
                        else if (prop.type === 'object') defaults[key] = '{"example": "value"}';
                        else if (prop.type === 'array') defaults[key] = '["example"]';
                    }
                );
            }
            return defaults;
        },
    },
    {
        name: 'Required Only',
        description: 'Fill only required fields',
        apply: (tool: McpTool) => {
            const defaults: Record<string, any> = {};
            if (tool.inputSchema?.properties && tool.inputSchema?.required) {
                tool.inputSchema.required.forEach((key: string) => {
                    const prop = tool.inputSchema!.properties![key];
                    if (prop.type === 'string') defaults[key] = '';
                    else if (prop.type === 'number') defaults[key] = '';
                    else if (prop.type === 'boolean') defaults[key] = false;
                    else if (prop.type === 'object') defaults[key] = '{}';
                    else if (prop.type === 'array') defaults[key] = '[]';
                });
            }
            return defaults;
        },
    },
    {
        name: 'Clear All',
        description: 'Clear all fields',
        apply: () => ({}),
    },
];

export function ToolInputForm({
    tool,
    inputs,
    errors,
    isLoading,
    onInputChange,
    onSubmit,
    onCopyConfig,
    onShareConfig,
}: ToolInputFormProps) {
    const hasInputs =
        tool.inputSchema?.properties && Object.keys(tool.inputSchema.properties).length > 0;
    const inputEntries: Array<[string, JsonSchemaProperty]> = [];
    for (const [key, prop] of Object.entries(tool.inputSchema?.properties ?? {})) {
        if (isJsonSchemaProperty(prop)) {
            inputEntries.push([key, prop]);
        }
    }

    const renderInput = (key: string, prop: JsonSchemaProperty) => {
        const isRequired = tool.inputSchema?.required?.includes(key);
        const errorMsg = errors[key];
        const baseInputClassName = `w-full ${errorMsg ? 'border-destructive focus-visible:ring-destructive' : ''}`;

        // Enum select
        if (prop.enum && Array.isArray(prop.enum)) {
            const isEnumBoolean = prop.enum.every(
                (v: string | number | boolean) => typeof v === 'boolean'
            );
            const isEnumNumeric = prop.enum.every(
                (v: string | number | boolean) => typeof v === 'number'
            );
            return (
                <Select
                    value={
                        inputs[key] === undefined && prop.default !== undefined
                            ? String(prop.default)
                            : String(inputs[key] || '')
                    }
                    onValueChange={(value) => {
                        let parsedValue: string | number | boolean = value;
                        if (isEnumBoolean) parsedValue = value === 'true';
                        else if (isEnumNumeric) parsedValue = Number(value);
                        onInputChange(key, parsedValue, prop.type);
                    }}
                    disabled={isLoading}
                >
                    <SelectTrigger id={key} className={baseInputClassName}>
                        <SelectValue
                            placeholder={`Select ${prop.description || key}${isRequired ? '' : ' (optional)'}...`}
                        />
                    </SelectTrigger>
                    <SelectContent>
                        {prop.enum.map((enumValue: string | number | boolean) => (
                            <SelectItem key={String(enumValue)} value={String(enumValue)}>
                                {String(enumValue)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            );
        }

        // Boolean checkbox
        if (prop.type === 'boolean') {
            return (
                <Checkbox
                    id={key}
                    checked={
                        inputs[key] === undefined && prop.default !== undefined
                            ? Boolean(prop.default)
                            : Boolean(inputs[key])
                    }
                    onCheckedChange={(checked) => onInputChange(key, checked, prop.type)}
                    disabled={isLoading}
                    className={errorMsg ? 'border-destructive ring-destructive' : ''}
                />
            );
        }

        // Object/Array textarea
        if (prop.type === 'object' || prop.type === 'array') {
            return (
                <Textarea
                    id={key}
                    value={
                        inputs[key] === undefined && prop.default !== undefined
                            ? JSON.stringify(prop.default, null, 2)
                            : inputs[key] || ''
                    }
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                        onInputChange(key, e.target.value, prop.type)
                    }
                    rows={5}
                    className={`${baseInputClassName} font-mono text-sm min-h-[100px] resize-y`}
                    placeholder={`Enter JSON for ${prop.description || key}`}
                    disabled={isLoading}
                />
            );
        }

        // String/Number input
        let inputFieldType: React.HTMLInputTypeAttribute = 'text';
        if (prop.type === 'number' || prop.type === 'integer') inputFieldType = 'number';
        if (prop.format === 'date-time') inputFieldType = 'datetime-local';
        if (prop.format === 'date') inputFieldType = 'date';
        if (prop.format === 'email') inputFieldType = 'email';
        if (prop.format === 'uri') inputFieldType = 'url';
        if (prop.format === 'password') inputFieldType = 'password';

        return (
            <Input
                type={inputFieldType}
                id={key}
                value={
                    inputs[key] === undefined && prop.default !== undefined
                        ? String(prop.default)
                        : String(inputs[key] || '')
                }
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    onInputChange(key, e.target.value, prop.type)
                }
                className={baseInputClassName}
                placeholder={prop.description || `Enter ${key}`}
                disabled={isLoading}
                step={prop.type === 'number' || prop.type === 'integer' ? 'any' : undefined}
            />
        );
    };

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                onSubmit();
            }}
            className="space-y-5 p-4 border border-border rounded-lg bg-card shadow-sm"
        >
            {/* Quick Fill Templates */}
            {hasInputs && (
                <div className="border-b border-border pb-4">
                    <h4 className="text-sm font-medium mb-2 text-muted-foreground">Quick Fill</h4>
                    <div className="flex flex-wrap gap-2">
                        {toolTemplates.map((template, index) => (
                            <Button
                                key={index}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    const newInputs = template.apply(tool);
                                    Object.entries(newInputs).forEach(([key, value]) => {
                                        const prop = tool.inputSchema?.properties?.[key];
                                        onInputChange(key, value, prop?.type);
                                    });
                                }}
                                className="text-xs"
                                title={template.description}
                            >
                                {template.name}
                            </Button>
                        ))}
                    </div>
                </div>
            )}

            {/* Form Inputs */}
            {!hasInputs && (
                <p className="text-sm text-muted-foreground py-2">
                    This tool does not require any inputs.
                </p>
            )}

            {hasInputs &&
                inputEntries.map(([key, prop]) => {
                    const isRequired = tool.inputSchema?.required?.includes(key);
                    const errorMsg = errors[key];

                    return (
                        <div key={key} className="grid gap-1.5">
                            <div
                                className={`flex ${
                                    prop.type === 'boolean'
                                        ? 'flex-row items-center space-x-3'
                                        : 'flex-col'
                                }`}
                            >
                                <Label
                                    htmlFor={key}
                                    className={`${
                                        prop.type === 'boolean'
                                            ? 'leading-none cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
                                            : 'capitalize font-medium'
                                    }`}
                                >
                                    {prop.description ||
                                        key
                                            .replace(/([A-Z]+(?=[A-Z][a-z]))|([A-Z][a-z])/g, ' $&')
                                            .trim()
                                            .replace(/_/g, ' ')}
                                    {isRequired && (
                                        <span className="text-destructive text-lg ml-0.5">*</span>
                                    )}
                                </Label>
                                {prop.type === 'boolean' ? (
                                    renderInput(key, prop)
                                ) : (
                                    <div className="w-full">{renderInput(key, prop)}</div>
                                )}
                            </div>
                            {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
                        </div>
                    );
                })}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2 pt-2">
                <Button
                    type="submit"
                    disabled={isLoading || Object.keys(errors).some((k) => errors[k] !== '')}
                    className="flex-1"
                >
                    {isLoading ? (
                        'Executing...'
                    ) : (
                        <>
                            <Zap className="h-4 w-4 mr-2" />
                            Run Tool
                        </>
                    )}
                </Button>

                {hasInputs && Object.keys(inputs).length > 0 && (
                    <>
                        {onCopyConfig && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={onCopyConfig}
                            >
                                <Copy className="h-3 w-3 mr-2" />
                                Copy
                            </Button>
                        )}
                        {onShareConfig && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={onShareConfig}
                            >
                                <Share2 className="h-3 w-3 mr-2" />
                                Share
                            </Button>
                        )}
                    </>
                )}
            </div>
        </form>
    );
}
