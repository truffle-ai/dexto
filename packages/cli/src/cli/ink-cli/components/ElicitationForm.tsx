/**
 * ElicitationForm Component
 * Renders a form for ask_user/elicitation requests in the CLI
 * Supports string, number, boolean, and enum field types
 */

import React, {
    useState,
    forwardRef,
    useImperativeHandle,
    useCallback,
    useEffect,
    useMemo,
} from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../hooks/useInputOrchestrator.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { truncateSingleLine } from '../utils/textUtils.js';
import type { ElicitationMetadata } from '@dexto/core';

export interface ElicitationFormHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ElicitationFormProps {
    metadata: ElicitationMetadata;
    onSubmit: (formData: Record<string, unknown>) => void;
    onCancel: () => void;
}

interface FormField {
    name: string;
    label: string; // title if available, otherwise name
    type: 'string' | 'number' | 'boolean' | 'enum' | 'array-enum';
    description: string | undefined;
    required: boolean;
    enumValues: unknown[] | undefined;
}

function getWindowRange(options: { selectedIndex: number; total: number; maxVisible: number }): {
    start: number;
    end: number;
} {
    if (options.total <= options.maxVisible) {
        return { start: 0, end: options.total };
    }

    const half = Math.floor(options.maxVisible / 2);
    const start = Math.min(
        Math.max(0, options.selectedIndex - half),
        Math.max(0, options.total - options.maxVisible)
    );
    const end = Math.min(options.total, start + options.maxVisible);
    return { start, end };
}

/**
 * Form component for elicitation/ask_user requests
 */
export const ElicitationForm = forwardRef<ElicitationFormHandle, ElicitationFormProps>(
    ({ metadata, onSubmit, onCancel }, ref) => {
        // Parse schema into form fields
        const fields = useMemo((): FormField[] => {
            const schema = metadata.schema;
            if (!schema?.properties) return [];

            const required = schema.required || [];
            return Object.entries(schema.properties)
                .filter(
                    (entry): entry is [string, Exclude<(typeof entry)[1], boolean>] =>
                        typeof entry[1] !== 'boolean'
                )
                .map(([name, prop]) => {
                    let type: FormField['type'] = 'string';
                    let enumValues: unknown[] | undefined;

                    if (prop.type === 'boolean') {
                        type = 'boolean';
                    } else if (prop.type === 'number' || prop.type === 'integer') {
                        type = 'number';
                    } else if (prop.enum && Array.isArray(prop.enum)) {
                        type = 'enum';
                        enumValues = prop.enum;
                    } else if (
                        prop.type === 'array' &&
                        typeof prop.items === 'object' &&
                        prop.items &&
                        'enum' in prop.items
                    ) {
                        type = 'array-enum';
                        enumValues = prop.items.enum as unknown[];
                    }

                    return {
                        name,
                        label: prop.title || name,
                        type,
                        description: prop.description,
                        required: required.includes(name),
                        enumValues,
                    };
                });
        }, [metadata.schema]);

        const { columns, rows } = useTerminalSize();

        // Form state
        const [activeFieldIndex, setActiveFieldIndex] = useState(0);
        const [formData, setFormData] = useState<Record<string, unknown>>({});
        const [currentInput, setCurrentInput] = useState('');
        const [enumIndex, setEnumIndex] = useState(0); // For enum selection
        const [arraySelections, setArraySelections] = useState<Set<number>>(new Set()); // For array-enum
        const [errors, setErrors] = useState<Record<string, string>>({});
        const [isReviewing, setIsReviewing] = useState(false); // Confirmation step before submit
        const [fieldScrollOffset, setFieldScrollOffset] = useState(0);
        const [reviewScrollOffset, setReviewScrollOffset] = useState(0);

        const maxVisibleFields = useMemo(() => {
            // Each field can take multiple lines (label + input + description).
            // Keep the form height stable by showing a small window of fields.
            return Math.max(3, Math.min(6, Math.floor((rows - 8) / 4)));
        }, [rows]);

        const maxVisibleReviewItems = useMemo(() => {
            // Review items are one line each.
            return Math.max(4, Math.min(12, rows - 6));
        }, [rows]);

        const maxVisibleEnumOptions = useMemo(() => {
            return Math.max(4, Math.min(10, rows - 12));
        }, [rows]);

        const activeField = fields[activeFieldIndex];

        useEffect(() => {
            const maxOffset = Math.max(0, fields.length - maxVisibleFields);
            setFieldScrollOffset((current) => {
                let next = current;
                if (activeFieldIndex < next) {
                    next = activeFieldIndex;
                } else if (activeFieldIndex >= next + maxVisibleFields) {
                    next = activeFieldIndex - maxVisibleFields + 1;
                }
                return Math.min(Math.max(0, next), maxOffset);
            });
        }, [activeFieldIndex, fields.length, maxVisibleFields]);

        useEffect(() => {
            if (isReviewing) {
                setReviewScrollOffset(0);
            }
        }, [isReviewing]);

        // Update a field value
        const updateField = useCallback((name: string, value: unknown) => {
            setFormData((prev) => ({ ...prev, [name]: value }));
            setErrors((prev) => {
                const newErrors = { ...prev };
                delete newErrors[name];
                return newErrors;
            });
        }, []);

        // Validate and enter review mode (or submit if already reviewing)
        // Accepts optional currentFieldValue to handle async state update timing
        const handleSubmit = useCallback(
            (currentFieldValue?: { name: string; value: unknown }) => {
                const newErrors: Record<string, string> = {};
                // Merge current field value since React state update is async
                const finalFormData = currentFieldValue
                    ? { ...formData, [currentFieldValue.name]: currentFieldValue.value }
                    : formData;

                for (const field of fields) {
                    if (field.required) {
                        const value = finalFormData[field.name];
                        if (value === undefined || value === null || value === '') {
                            newErrors[field.name] = 'Required';
                        }
                    }
                }

                if (Object.keys(newErrors).length > 0) {
                    setErrors(newErrors);
                    // Focus first error field
                    const firstErrorField = fields.findIndex((f) => newErrors[f.name]);
                    if (firstErrorField >= 0) {
                        setActiveFieldIndex(firstErrorField);
                    }
                    return;
                }

                // Update formData with final value and enter review mode
                if (currentFieldValue) {
                    setFormData(finalFormData);
                }
                setIsReviewing(true);
            },
            [fields, formData]
        );

        // Final submission after review
        const confirmSubmit = useCallback(() => {
            onSubmit(formData);
        }, [formData, onSubmit]);

        // Navigate to next/previous field
        const nextField = useCallback(() => {
            if (activeFieldIndex < fields.length - 1) {
                // Save current input for string/number fields
                if (activeField?.type === 'string' || activeField?.type === 'number') {
                    if (currentInput.trim()) {
                        const value =
                            activeField.type === 'number' ? Number(currentInput) : currentInput;
                        updateField(activeField.name, value);
                    }
                }
                setActiveFieldIndex((prev) => prev + 1);
                setCurrentInput('');
                setEnumIndex(0);
                setArraySelections(new Set());
            }
        }, [activeFieldIndex, fields.length, activeField, currentInput, updateField]);

        const prevField = useCallback(() => {
            if (activeFieldIndex > 0) {
                setActiveFieldIndex((prev) => prev - 1);
                setCurrentInput('');
                setEnumIndex(0);
                setArraySelections(new Set());
            }
        }, [activeFieldIndex]);

        // Handle keyboard input
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    // Review mode handling
                    if (isReviewing) {
                        if (key.upArrow) {
                            setReviewScrollOffset((current) => Math.max(0, current - 1));
                            return true;
                        }
                        if (key.downArrow) {
                            const maxOffset = Math.max(0, fields.length - maxVisibleReviewItems);
                            setReviewScrollOffset((current) => Math.min(maxOffset, current + 1));
                            return true;
                        }
                        if (key.return) {
                            confirmSubmit();
                            return true;
                        }
                        // Backspace to go back to editing
                        if (key.backspace || key.delete) {
                            setIsReviewing(false);
                            return true;
                        }
                        // Esc to cancel entirely
                        if (key.escape) {
                            onCancel();
                            return true;
                        }
                        return false;
                    }

                    // Escape to cancel
                    if (key.escape) {
                        onCancel();
                        return true;
                    }

                    if (!activeField) return false;

                    // Shift+Tab or Up to previous field (check BEFORE plain Tab)
                    if (
                        (key.tab && key.shift) ||
                        (key.upArrow &&
                            activeField.type !== 'enum' &&
                            activeField.type !== 'array-enum')
                    ) {
                        prevField();
                        return true;
                    }

                    // Tab (without Shift) or Down to next field
                    if (
                        (key.tab && !key.shift) ||
                        (key.downArrow &&
                            activeField.type !== 'enum' &&
                            activeField.type !== 'array-enum')
                    ) {
                        nextField();
                        return true;
                    }

                    // Field-specific handling
                    switch (activeField.type) {
                        case 'boolean': {
                            // Space or Enter to toggle
                            if (input === ' ' || key.return) {
                                const current = formData[activeField.name] === true;
                                const newValue = !current;
                                updateField(activeField.name, newValue);
                                if (key.return) {
                                    if (activeFieldIndex === fields.length - 1) {
                                        handleSubmit({ name: activeField.name, value: newValue });
                                    } else {
                                        nextField();
                                    }
                                }
                                return true;
                            }
                            // Left/Right to toggle
                            if (key.leftArrow || key.rightArrow) {
                                const current = formData[activeField.name] === true;
                                updateField(activeField.name, !current);
                                return true;
                            }
                            break;
                        }

                        case 'enum': {
                            const values = activeField.enumValues || [];
                            // Up/Down to navigate enum
                            if (key.upArrow) {
                                setEnumIndex((prev) => (prev > 0 ? prev - 1 : values.length - 1));
                                return true;
                            }
                            if (key.downArrow) {
                                setEnumIndex((prev) => (prev < values.length - 1 ? prev + 1 : 0));
                                return true;
                            }
                            // Enter to select and move to next (or submit if last)
                            if (key.return) {
                                const selectedValue = values[enumIndex];
                                updateField(activeField.name, selectedValue);
                                if (activeFieldIndex === fields.length - 1) {
                                    handleSubmit({ name: activeField.name, value: selectedValue });
                                } else {
                                    nextField();
                                }
                                return true;
                            }
                            break;
                        }

                        case 'array-enum': {
                            const values = activeField.enumValues || [];
                            // Up/Down to navigate
                            if (key.upArrow) {
                                setEnumIndex((prev) => (prev > 0 ? prev - 1 : values.length - 1));
                                return true;
                            }
                            if (key.downArrow) {
                                setEnumIndex((prev) => (prev < values.length - 1 ? prev + 1 : 0));
                                return true;
                            }
                            // Space to toggle selection
                            if (input === ' ') {
                                setArraySelections((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(enumIndex)) {
                                        next.delete(enumIndex);
                                    } else {
                                        next.add(enumIndex);
                                    }
                                    // Update form data
                                    const selected = Array.from(next).map((i) => values[i]);
                                    updateField(activeField.name, selected);
                                    return next;
                                });
                                return true;
                            }
                            // Enter to confirm and move to next (or submit if last)
                            if (key.return) {
                                // Get current selections for submit
                                const selected = Array.from(arraySelections).map((i) => values[i]);
                                if (activeFieldIndex === fields.length - 1) {
                                    handleSubmit({ name: activeField.name, value: selected });
                                } else {
                                    nextField();
                                }
                                return true;
                            }
                            break;
                        }

                        case 'string':
                        case 'number': {
                            // Enter to confirm field and move to next (or submit if last)
                            if (key.return) {
                                const value = currentInput.trim()
                                    ? activeField.type === 'number'
                                        ? Number(currentInput)
                                        : currentInput
                                    : formData[activeField.name]; // Use existing value if no new input
                                if (currentInput.trim()) {
                                    updateField(activeField.name, value);
                                }
                                if (activeFieldIndex === fields.length - 1) {
                                    // Last field - submit with current value
                                    handleSubmit(
                                        value !== undefined
                                            ? { name: activeField.name, value }
                                            : undefined
                                    );
                                } else {
                                    nextField();
                                }
                                return true;
                            }
                            // Backspace
                            if (key.backspace || key.delete) {
                                setCurrentInput((prev) => prev.slice(0, -1));
                                return true;
                            }
                            // Regular character input
                            if (input && !key.ctrl && !key.meta) {
                                // For number type, only allow digits and decimal
                                if (activeField.type === 'number') {
                                    if (/^[\d.-]$/.test(input)) {
                                        setCurrentInput((prev) => prev + input);
                                    }
                                } else {
                                    setCurrentInput((prev) => prev + input);
                                }
                                return true;
                            }
                            break;
                        }
                    }

                    return false;
                },
            }),
            [
                activeField,
                activeFieldIndex,
                arraySelections,
                confirmSubmit,
                currentInput,
                enumIndex,
                fields.length,
                formData,
                handleSubmit,
                isReviewing,
                maxVisibleReviewItems,
                nextField,
                onCancel,
                prevField,
                reviewScrollOffset,
                updateField,
            ]
        );

        if (fields.length === 0) {
            return (
                <Box flexDirection="column" paddingX={1}>
                    <Text color="red">Invalid form schema</Text>
                </Box>
            );
        }

        const prompt = metadata.prompt;

        // Review mode - show summary of choices
        if (isReviewing) {
            const visibleReviewFields = fields.slice(
                reviewScrollOffset,
                reviewScrollOffset + maxVisibleReviewItems
            );
            return (
                <Box flexDirection="column" paddingX={0} paddingY={0}>
                    <Box marginBottom={1}>
                        <Text color="green" bold>
                            ✓ Review your answers:
                        </Text>
                    </Box>

                    {visibleReviewFields.map((field) => {
                        const value = formData[field.name];
                        const displayValue = Array.isArray(value)
                            ? value.join(', ')
                            : value === true
                              ? 'Yes'
                              : value === false
                                ? 'No'
                                : String(value ?? '');
                        return (
                            <Box key={field.name} marginBottom={0}>
                                <Text>
                                    <Text color="cyan">{field.label}</Text>
                                    <Text>: </Text>
                                    <Text color="green">{displayValue}</Text>
                                </Text>
                            </Box>
                        );
                    })}

                    {fields.length > maxVisibleReviewItems && (
                        <Box marginTop={0}>
                            <Text color="gray">
                                {reviewScrollOffset > 0 ? '↑ more above' : ''}
                                {reviewScrollOffset > 0 &&
                                reviewScrollOffset + maxVisibleReviewItems < fields.length
                                    ? ' | '
                                    : ''}
                                {reviewScrollOffset + maxVisibleReviewItems < fields.length
                                    ? '↓ more below'
                                    : ''}
                            </Text>
                        </Box>
                    )}

                    <Box marginTop={1}>
                        <Text color="gray">
                            Enter to submit • Backspace to edit • Esc to cancel
                        </Text>
                    </Box>
                </Box>
            );
        }

        const visibleFields = fields.slice(fieldScrollOffset, fieldScrollOffset + maxVisibleFields);

        return (
            <Box flexDirection="column" paddingX={0} paddingY={0}>
                {/* Header */}
                <Box marginBottom={1}>
                    <Text color="yellowBright" bold>
                        📝 {prompt}
                    </Text>
                </Box>

                {/* Form fields */}
                {visibleFields.map((field, index) => {
                    const actualIndex = fieldScrollOffset + index;
                    const isActive = actualIndex === activeFieldIndex;
                    const value = formData[field.name];
                    const error = errors[field.name];

                    return (
                        <Box key={field.name} flexDirection="column" marginBottom={1}>
                            {/* Field label */}
                            <Box>
                                <Text color={isActive ? 'cyan' : 'white'} bold={isActive}>
                                    {isActive ? '▶ ' : '  '}
                                    {field.label}
                                    {field.required && <Text color="red">*</Text>}
                                    {': '}
                                </Text>

                                {/* Field value display */}
                                {field.type === 'boolean' && (
                                    <Text color={value === true ? 'green' : 'gray'}>
                                        {value === true ? '[✓] Yes' : '[ ] No'}
                                        {isActive && <Text color="gray"> (Space to toggle)</Text>}
                                    </Text>
                                )}

                                {field.type === 'string' && !isActive && value !== undefined && (
                                    <Text color="green">{String(value)}</Text>
                                )}

                                {field.type === 'number' && !isActive && value !== undefined && (
                                    <Text color="green">{String(value)}</Text>
                                )}

                                {field.type === 'enum' && !isActive && value !== undefined && (
                                    <Text color="green">{String(value)}</Text>
                                )}

                                {field.type === 'array-enum' &&
                                    !isActive &&
                                    Array.isArray(value) &&
                                    value.length > 0 && (
                                        <Text color="green">{value.join(', ')}</Text>
                                    )}
                            </Box>

                            {/* Active field input */}
                            {isActive && (field.type === 'string' || field.type === 'number') && (
                                <Box marginLeft={2}>
                                    <Text color="cyan">&gt; </Text>
                                    <Text>{currentInput}</Text>
                                    <Text color="cyan">_</Text>
                                </Box>
                            )}

                            {/* Enum selection */}
                            {isActive && field.type === 'enum' && field.enumValues && (
                                <Box flexDirection="column" marginLeft={2}>
                                    {(() => {
                                        const values = field.enumValues ?? [];
                                        const range = getWindowRange({
                                            selectedIndex: enumIndex,
                                            total: values.length,
                                            maxVisible: maxVisibleEnumOptions,
                                        });
                                        const visibleValues = values.slice(range.start, range.end);

                                        return (
                                            <>
                                                {visibleValues.map((opt, i) => {
                                                    const absoluteIndex = range.start + i;
                                                    const isSelected = absoluteIndex === enumIndex;
                                                    return (
                                                        <Box
                                                            key={`${absoluteIndex}-${String(opt)}`}
                                                        >
                                                            <Text
                                                                color={
                                                                    isSelected ? 'green' : 'gray'
                                                                }
                                                            >
                                                                {isSelected ? '  ▶ ' : '    '}
                                                                {String(opt)}
                                                            </Text>
                                                        </Box>
                                                    );
                                                })}

                                                {values.length > maxVisibleEnumOptions && (
                                                    <Box marginTop={0}>
                                                        <Text color="gray">
                                                            {range.start > 0 ? '↑ more above' : ''}
                                                            {range.start > 0 &&
                                                            range.end < values.length
                                                                ? ' | '
                                                                : ''}
                                                            {range.end < values.length
                                                                ? '↓ more below'
                                                                : ''}
                                                        </Text>
                                                    </Box>
                                                )}
                                            </>
                                        );
                                    })()}
                                </Box>
                            )}

                            {/* Array-enum multi-select */}
                            {isActive && field.type === 'array-enum' && field.enumValues && (
                                <Box flexDirection="column" marginLeft={2}>
                                    <Text color="gray"> (Space to select, Enter to confirm)</Text>
                                    {(() => {
                                        const values = field.enumValues ?? [];
                                        const range = getWindowRange({
                                            selectedIndex: enumIndex,
                                            total: values.length,
                                            maxVisible: maxVisibleEnumOptions,
                                        });
                                        const visibleValues = values.slice(range.start, range.end);

                                        return (
                                            <>
                                                {visibleValues.map((opt, i) => {
                                                    const absoluteIndex = range.start + i;
                                                    const isCursor = absoluteIndex === enumIndex;
                                                    const isSelected =
                                                        arraySelections.has(absoluteIndex);
                                                    return (
                                                        <Box
                                                            key={`${absoluteIndex}-${String(opt)}`}
                                                        >
                                                            <Text
                                                                color={isCursor ? 'cyan' : 'gray'}
                                                            >
                                                                {isCursor ? '  ▶ ' : '    '}
                                                                <Text
                                                                    color={
                                                                        isSelected
                                                                            ? 'green'
                                                                            : 'gray'
                                                                    }
                                                                >
                                                                    {isSelected ? '[✓]' : '[ ]'}
                                                                </Text>{' '}
                                                                {String(opt)}
                                                            </Text>
                                                        </Box>
                                                    );
                                                })}

                                                {values.length > maxVisibleEnumOptions && (
                                                    <Box marginTop={0}>
                                                        <Text color="gray">
                                                            {range.start > 0 ? '↑ more above' : ''}
                                                            {range.start > 0 &&
                                                            range.end < values.length
                                                                ? ' | '
                                                                : ''}
                                                            {range.end < values.length
                                                                ? '↓ more below'
                                                                : ''}
                                                        </Text>
                                                    </Box>
                                                )}
                                            </>
                                        );
                                    })()}
                                </Box>
                            )}

                            {/* Field description */}
                            {isActive && field.description && (
                                <Box marginLeft={2}>
                                    <Text color="gray">
                                        {truncateSingleLine(
                                            field.description,
                                            Math.max(1, columns - 6)
                                        )}
                                    </Text>
                                </Box>
                            )}

                            {/* Error message */}
                            {error && (
                                <Box marginLeft={2}>
                                    <Text color="red">{error}</Text>
                                </Box>
                            )}
                        </Box>
                    );
                })}

                {fields.length > maxVisibleFields && (
                    <Box marginTop={0}>
                        <Text color="gray">
                            {fieldScrollOffset > 0 ? '↑ more above' : ''}
                            {fieldScrollOffset > 0 &&
                            fieldScrollOffset + maxVisibleFields < fields.length
                                ? ' | '
                                : ''}
                            {fieldScrollOffset + maxVisibleFields < fields.length
                                ? '↓ more below'
                                : ''}
                        </Text>
                    </Box>
                )}

                {/* Help text */}
                <Box marginTop={1}>
                    <Text color="gray">
                        Tab/↓ next field • Shift+Tab/↑ prev • Enter to confirm • Esc to cancel
                    </Text>
                </Box>
            </Box>
        );
    }
);

ElicitationForm.displayName = 'ElicitationForm';
