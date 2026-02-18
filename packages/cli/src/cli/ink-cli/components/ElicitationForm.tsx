/**
 * ElicitationForm Component
 * Renders a form for ask_user/elicitation requests in the CLI.
 *
 * Uses a wizard flow (one question at a time) to avoid huge modals and improve
 * usability on small terminals.
 */

import React, { useState, forwardRef, useImperativeHandle, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import type { ElicitationMetadata } from '@dexto/core';
import type { Key } from '../hooks/useInputOrchestrator.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';

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
    chipLabel: string;
    question: string;
    helpText: string | undefined;
    type: 'string' | 'number' | 'boolean' | 'enum' | 'array-enum';
    required: boolean;
    enumValues: unknown[] | undefined;
}

function hasOwn(obj: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function getDisplayValue(value: unknown): string {
    if (Array.isArray(value)) return value.join(', ');
    if (value === true) return 'Yes';
    if (value === false) return 'No';
    return String(value ?? '');
}

function humanizeIdentifier(value: string): string {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function titleCaseWords(value: string): string {
    return value
        .split(' ')
        .map((word) => {
            if (!word) return '';
            return word[0]!.toUpperCase() + word.slice(1);
        })
        .join(' ');
}

function cleanLabel(value: string): string {
    return value
        .replace(/^\s*\d+\s*[).:-]\s*/g, '')
        .replace(/\s*[:*]\s*$/g, '')
        .trim();
}

function stripWrappingParens(value: string): string {
    const trimmed = value.trim();
    if (trimmed.startsWith('(') && trimmed.endsWith(')') && trimmed.length >= 2) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}

function splitQuestionAndDetail(text: string): { main: string; detail: string | undefined } {
    const cleaned = cleanLabel(text);
    if (!cleaned) return { main: '', detail: undefined };

    const questionIndex = cleaned.indexOf('?');
    if (questionIndex >= 0 && questionIndex < cleaned.length - 1) {
        const main = cleaned.slice(0, questionIndex + 1).trim();
        const detail = stripWrappingParens(cleaned.slice(questionIndex + 1));
        return { main, detail: detail || undefined };
    }

    const parenIndex = cleaned.indexOf('(');
    if (parenIndex >= 12 && parenIndex < cleaned.length - 1) {
        const main = cleaned.slice(0, parenIndex).trim();
        const detail = stripWrappingParens(cleaned.slice(parenIndex));
        return { main, detail: detail || undefined };
    }

    return { main: cleaned, detail: undefined };
}

function combineHelpText(...parts: Array<string | undefined>): string | undefined {
    const text = parts
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter(Boolean)
        .join(' • ')
        .trim();

    return text || undefined;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/**
 * Form component for elicitation/ask_user requests
 */
export const ElicitationForm = forwardRef<ElicitationFormHandle, ElicitationFormProps>(
    ({ metadata, onSubmit, onCancel }, ref) => {
        const { rows: terminalRows, columns: terminalColumns } = useTerminalSize();

        const viewportHeight = useMemo(() => {
            // Ink clears + redraws when dynamic output height >= terminal rows, which looks like flicker.
            // Keep the elicitation UI small and scroll internally to stay under that threshold.
            // Leave slack so Ink doesn't hit the "clear + redraw everything" path.
            // (Ink clears when dynamic output height >= terminal rows.)
            const reservedRows = 12;
            const maxHeight = Math.max(4, terminalRows - reservedRows);
            const desired = Math.max(4, Math.floor(terminalRows * 0.6));
            return Math.min(maxHeight, desired);
        }, [terminalRows]);

        const headerHeight = 5; // prompt + stepper + question + description + error
        const footerHeight = 1; // key hints
        const contentHeight = Math.max(1, viewportHeight - headerHeight - footerHeight);

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

                    const fallbackLabel = titleCaseWords(humanizeIdentifier(name)) || name;
                    const title = typeof prop.title === 'string' ? cleanLabel(prop.title) : '';
                    const description =
                        typeof prop.description === 'string' ? cleanLabel(prop.description) : '';

                    const chipLabel = title || fallbackLabel;
                    const questionLike = (text: string) =>
                        text.includes('?') ||
                        text.length >= 45 ||
                        text.toLowerCase().startsWith('how ') ||
                        text.toLowerCase().startsWith('what ') ||
                        text.toLowerCase().startsWith('why ') ||
                        text.toLowerCase().startsWith('when ') ||
                        text.toLowerCase().startsWith('where ');

                    let questionRaw = chipLabel;
                    let helpRaw: string | undefined = undefined;

                    if (description && questionLike(description)) {
                        questionRaw = description;
                        helpRaw = title ? chipLabel : undefined;
                    } else if (title && questionLike(title)) {
                        questionRaw = title;
                        helpRaw = description || undefined;
                    } else {
                        questionRaw = chipLabel;
                        helpRaw = description || undefined;
                    }

                    const { main: question, detail } = splitQuestionAndDetail(questionRaw);
                    const helpText = combineHelpText(detail, helpRaw);

                    return {
                        name,
                        chipLabel,
                        question: question || chipLabel,
                        type,
                        helpText,
                        required: required.includes(name),
                        enumValues,
                    };
                });
        }, [metadata.schema]);

        // Form state
        const [activeFieldIndex, setActiveFieldIndex] = useState(0);
        const [formData, setFormData] = useState<Record<string, unknown>>({});
        const [draftInputs, setDraftInputs] = useState<Record<string, string>>({});
        const [enumIndex, setEnumIndex] = useState(0); // For enum/array-enum focus
        const [arraySelections, setArraySelections] = useState<Set<number>>(new Set()); // array-enum
        const [errors, setErrors] = useState<Record<string, string>>({});
        const [isReviewing, setIsReviewing] = useState(false);
        const [reviewScrollTop, setReviewScrollTop] = useState(0);

        const activeField = fields[activeFieldIndex];

        const updateField = useCallback((name: string, value: unknown) => {
            setFormData((prev) => ({ ...prev, [name]: value }));
            setErrors((prev) => {
                if (!hasOwn(prev, name)) return prev;
                const next = { ...prev };
                delete next[name];
                return next;
            });
        }, []);

        const goToFieldIndex = useCallback(
            (index: number, data: Record<string, unknown> = formData) => {
                if (index < 0 || index >= fields.length) return;

                setActiveFieldIndex(index);
                const field = fields[index];
                if (!field) return;

                if (field.type === 'boolean') {
                    if (data[field.name] === undefined) {
                        updateField(field.name, false);
                        data = { ...data, [field.name]: false };
                    }
                    setEnumIndex(data[field.name] === true ? 0 : 1);
                    setArraySelections(new Set());
                    return;
                }

                if (field.type === 'enum') {
                    const values = field.enumValues ?? [];
                    const currentValue = data[field.name];
                    const currentIndex = values.findIndex((v) => v === currentValue);
                    setEnumIndex(currentIndex >= 0 ? currentIndex : 0);
                    setArraySelections(new Set());
                    return;
                }

                if (field.type === 'array-enum') {
                    const values = field.enumValues ?? [];
                    const currentValue = data[field.name];
                    const currentValues = Array.isArray(currentValue) ? currentValue : [];

                    const selections = new Set<number>();
                    for (const selectedValue of currentValues) {
                        const selectedIndex = values.findIndex((v) => v === selectedValue);
                        if (selectedIndex >= 0) selections.add(selectedIndex);
                    }

                    setArraySelections(selections);

                    const firstSelected = selections.values().next().value as number | undefined;
                    const maxIndex = Math.max(0, values.length - 1);
                    setEnumIndex(Math.min(firstSelected ?? 0, maxIndex));
                    return;
                }

                setEnumIndex(0);
                setArraySelections(new Set());
            },
            [fields, formData, updateField]
        );

        const nextField = useCallback(() => {
            if (activeFieldIndex < fields.length - 1) {
                goToFieldIndex(activeFieldIndex + 1);
            }
        }, [activeFieldIndex, fields.length, goToFieldIndex]);

        const prevField = useCallback(() => {
            if (activeFieldIndex > 0) {
                goToFieldIndex(activeFieldIndex - 1);
            }
        }, [activeFieldIndex, goToFieldIndex]);

        const handleSubmit = useCallback(
            (currentFieldValue?: { name: string; value: unknown }) => {
                const newErrors: Record<string, string> = {};
                const finalFormData: Record<string, unknown> = currentFieldValue
                    ? { ...formData, [currentFieldValue.name]: currentFieldValue.value }
                    : { ...formData };

                // Incorporate draft inputs (wizard UX is forgiving if you navigate without pressing Enter).
                for (const field of fields) {
                    if (!hasOwn(draftInputs, field.name)) continue;

                    const rawDraft = draftInputs[field.name] ?? '';

                    if (field.type === 'number') {
                        const trimmed = rawDraft.trim();
                        if (trimmed === '') {
                            finalFormData[field.name] = '';
                            continue;
                        }

                        const parsed = Number(trimmed);
                        if (Number.isNaN(parsed)) {
                            newErrors[field.name] = 'Invalid number';
                            continue;
                        }

                        finalFormData[field.name] = parsed;
                    }

                    if (field.type === 'string') {
                        finalFormData[field.name] = rawDraft;
                    }
                }

                // Ensure boolean fields are always present in submitted data.
                for (const field of fields) {
                    if (field.type !== 'boolean') continue;
                    if (finalFormData[field.name] === undefined) {
                        finalFormData[field.name] = false;
                    }
                }

                for (const field of fields) {
                    if (!field.required) continue;
                    const value = finalFormData[field.name];

                    if (field.type === 'array-enum') {
                        if (!Array.isArray(value) || value.length === 0) {
                            newErrors[field.name] = 'Required';
                        }
                        continue;
                    }

                    if (value === undefined || value === null || value === '') {
                        newErrors[field.name] = 'Required';
                    }
                }

                if (Object.keys(newErrors).length > 0) {
                    setErrors(newErrors);
                    const firstErrorField = fields.findIndex((f) => newErrors[f.name]);
                    if (firstErrorField >= 0) {
                        goToFieldIndex(firstErrorField, finalFormData);
                    }
                    setIsReviewing(false);
                    return;
                }

                setFormData(finalFormData);
                setReviewScrollTop(0);
                setIsReviewing(true);
            },
            [draftInputs, fields, formData, goToFieldIndex]
        );

        const confirmSubmit = useCallback(() => {
            onSubmit(formData);
        }, [formData, onSubmit]);

        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    if (isReviewing) {
                        const maxScrollTop = Math.max(0, fields.length - contentHeight);

                        if (key.return) {
                            confirmSubmit();
                            return true;
                        }
                        if (key.backspace || key.delete) {
                            setIsReviewing(false);
                            goToFieldIndex(Math.max(0, fields.length - 1));
                            return true;
                        }
                        if (key.leftArrow || (key.tab && key.shift)) {
                            setIsReviewing(false);
                            goToFieldIndex(Math.max(0, fields.length - 1));
                            return true;
                        }
                        if (key.upArrow) {
                            setReviewScrollTop((prev) => Math.max(0, prev - 1));
                            return true;
                        }
                        if (key.downArrow) {
                            setReviewScrollTop((prev) => Math.min(maxScrollTop, prev + 1));
                            return true;
                        }
                        if (key.pageUp) {
                            setReviewScrollTop((prev) => Math.max(0, prev - 5));
                            return true;
                        }
                        if (key.pageDown) {
                            setReviewScrollTop((prev) => Math.min(maxScrollTop, prev + 5));
                            return true;
                        }
                        if (key.escape) {
                            onCancel();
                            return true;
                        }
                        return false;
                    }

                    if (key.escape) {
                        onCancel();
                        return true;
                    }

                    if (!activeField) return false;

                    // Wizard navigation: Left/Right (or Shift+Tab/Tab) changes the question.
                    if (key.leftArrow || (key.tab && key.shift)) {
                        prevField();
                        return true;
                    }

                    if (key.rightArrow || (key.tab && !key.shift)) {
                        if (activeFieldIndex === fields.length - 1) {
                            handleSubmit();
                        } else {
                            nextField();
                        }
                        return true;
                    }

                    const setDraftValue = (updater: (prev: string) => string) => {
                        setDraftInputs((prev) => {
                            const current = hasOwn(prev, activeField.name)
                                ? (prev[activeField.name] ?? '')
                                : (() => {
                                      const existing = formData[activeField.name];
                                      return existing === undefined || existing === null
                                          ? ''
                                          : String(existing);
                                  })();

                            if (hasOwn(errors, activeField.name)) {
                                setErrors((prevErrors) => {
                                    const nextErrors = { ...prevErrors };
                                    delete nextErrors[activeField.name];
                                    return nextErrors;
                                });
                            }

                            return { ...prev, [activeField.name]: updater(current) };
                        });
                    };

                    switch (activeField.type) {
                        case 'boolean': {
                            if (key.upArrow) {
                                setEnumIndex((prev) => {
                                    const nextIndex = clamp(prev - 1, 0, 1);
                                    updateField(activeField.name, nextIndex === 0);
                                    return nextIndex;
                                });
                                return true;
                            }
                            if (key.downArrow) {
                                setEnumIndex((prev) => {
                                    const nextIndex = clamp(prev + 1, 0, 1);
                                    updateField(activeField.name, nextIndex === 0);
                                    return nextIndex;
                                });
                                return true;
                            }
                            if (input === ' ') {
                                setEnumIndex((prev) => {
                                    const nextIndex = prev === 0 ? 1 : 0;
                                    updateField(activeField.name, nextIndex === 0);
                                    return nextIndex;
                                });
                                return true;
                            }
                            if (key.return) {
                                const nextValue = enumIndex === 0;
                                updateField(activeField.name, nextValue);
                                if (activeFieldIndex === fields.length - 1) {
                                    handleSubmit({ name: activeField.name, value: nextValue });
                                } else {
                                    nextField();
                                }
                                return true;
                            }
                            break;
                        }

                        case 'enum': {
                            const values = activeField.enumValues || [];
                            if (key.upArrow) {
                                setEnumIndex((prev) => (prev > 0 ? prev - 1 : values.length - 1));
                                return true;
                            }
                            if (key.downArrow) {
                                setEnumIndex((prev) => (prev < values.length - 1 ? prev + 1 : 0));
                                return true;
                            }
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
                            if (key.upArrow) {
                                setEnumIndex((prev) => (prev > 0 ? prev - 1 : values.length - 1));
                                return true;
                            }
                            if (key.downArrow) {
                                setEnumIndex((prev) => (prev < values.length - 1 ? prev + 1 : 0));
                                return true;
                            }
                            if (input === ' ') {
                                setArraySelections((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(enumIndex)) next.delete(enumIndex);
                                    else next.add(enumIndex);

                                    const selected = Array.from(next).map((i) => values[i]);
                                    updateField(activeField.name, selected);
                                    return next;
                                });
                                return true;
                            }
                            if (key.return) {
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
                            const hasDraft = hasOwn(draftInputs, activeField.name);
                            const rawInput = hasDraft
                                ? (draftInputs[activeField.name] ?? '')
                                : (() => {
                                      const existing = formData[activeField.name];
                                      return existing === undefined || existing === null
                                          ? ''
                                          : String(existing);
                                  })();

                            if (key.return) {
                                let value: unknown = hasDraft
                                    ? rawInput
                                    : formData[activeField.name];

                                if (activeField.type === 'number' && hasDraft) {
                                    const trimmed = rawInput.trim();
                                    if (trimmed === '') {
                                        value = '';
                                    } else {
                                        const parsed = Number(trimmed);
                                        if (Number.isNaN(parsed)) {
                                            setErrors((prev) => ({
                                                ...prev,
                                                [activeField.name]: 'Invalid number',
                                            }));
                                            return true;
                                        }
                                        value = parsed;
                                    }
                                }

                                if (hasDraft) {
                                    updateField(activeField.name, value);
                                }

                                if (activeFieldIndex === fields.length - 1) {
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

                            if (key.backspace || key.delete) {
                                setDraftValue((prev) => prev.slice(0, -1));
                                return true;
                            }

                            if (input && !key.ctrl && !key.meta) {
                                if (activeField.type === 'number') {
                                    // Accept either single-key entry or paste: filter to allowed chars.
                                    const filtered = input.replace(/[^\d.-]/g, '');
                                    if (filtered.length > 0) {
                                        setDraftValue((prev) => prev + filtered);
                                    }
                                } else {
                                    setDraftValue((prev) => prev + input);
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
                contentHeight,
                confirmSubmit,
                draftInputs,
                errors,
                fields,
                formData,
                handleSubmit,
                isReviewing,
                goToFieldIndex,
                nextField,
                onCancel,
                prevField,
                reviewScrollTop,
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

        const activeStepIndex = isReviewing ? fields.length : activeFieldIndex;
        const windowCenterIndex =
            activeStepIndex >= fields.length ? Math.max(0, fields.length - 1) : activeStepIndex;

        const stepper = (() => {
            const maxChipLabelChars = terminalColumns >= 90 ? 14 : 10;
            const chipLabel = (text: string) => {
                const cleaned = cleanLabel(text);
                if (cleaned.length <= maxChipLabelChars) return cleaned;
                return `${cleaned.slice(0, Math.max(0, maxChipLabelChars - 1))}…`;
            };

            const isAnswered = (field: FormField): boolean => {
                if (field.type === 'boolean') return hasOwn(formData, field.name);
                if (field.type === 'enum') return hasOwn(formData, field.name);
                if (field.type === 'array-enum') {
                    const value = formData[field.name];
                    return Array.isArray(value) && value.length > 0;
                }
                const draft = draftInputs[field.name];
                if (typeof draft === 'string' && draft.trim() !== '') return true;
                const value = formData[field.name];
                return value !== undefined && value !== null && value !== '';
            };

            const maxWindow = 7;
            const totalFields = fields.length;
            const maxVisible = Math.min(totalFields, maxWindow);

            let windowSize = maxVisible;
            let start = 0;

            const calcLength = (startIndex: number, size: number): number => {
                const endIndex = startIndex + size - 1;
                const leftEllipsis = startIndex > 0 ? 2 : 0; // "… "
                const rightEllipsis = endIndex < totalFields - 1 ? 2 : 0; // " …"
                const arrowLen = 2 + 2; // "← " + " →"
                const submitLen = 8; // "□ Submit"
                let chipsLen = 0;
                for (let i = 0; i < size; i++) {
                    const field = fields[startIndex + i]!;
                    const label = chipLabel(field.chipLabel);
                    const chipLen = 2 + 1 + label.length; // "□ " + label
                    const sep = i === 0 ? 0 : 2; // two spaces
                    chipsLen += sep + chipLen;
                }
                const sepToSubmit = chipsLen > 0 ? 2 : 0;
                return arrowLen + leftEllipsis + chipsLen + rightEllipsis + sepToSubmit + submitLen;
            };

            while (windowSize > 1) {
                start = clamp(
                    windowCenterIndex - Math.floor(windowSize / 2),
                    0,
                    Math.max(0, totalFields - windowSize)
                );
                if (calcLength(start, windowSize) <= terminalColumns) break;
                windowSize -= 1;
            }

            start = clamp(
                windowCenterIndex - Math.floor(windowSize / 2),
                0,
                Math.max(0, totalFields - windowSize)
            );
            const end = start + windowSize - 1;

            const items = fields.slice(start, end + 1).map((field, i) => {
                const index = start + i;
                const active = index === activeStepIndex;
                const complete = isAnswered(field);
                return { key: field.name, label: chipLabel(field.chipLabel), active, complete };
            });

            return {
                items,
                leftEllipsis: start > 0,
                rightEllipsis: end < totalFields - 1,
                submit: {
                    active: activeStepIndex === fields.length,
                    complete: isReviewing,
                },
            };
        })();

        if (!isReviewing && !activeField) {
            return (
                <Box flexDirection="column" paddingX={1}>
                    <Text color="red">Invalid form state</Text>
                </Box>
            );
        }

        const value = activeField ? formData[activeField.name] : undefined;
        const currentInput =
            activeField && hasOwn(draftInputs, activeField.name)
                ? (draftInputs[activeField.name] ?? '')
                : value === undefined || value === null
                  ? ''
                  : String(value);

        const errorText = activeField ? (errors[activeField.name] ?? '') : '';

        const renderContent = () => {
            if (isReviewing) {
                return (
                    <Box
                        overflowY="scroll"
                        overflowX="hidden"
                        scrollTop={reviewScrollTop}
                        scrollbarThumbColor="gray"
                        flexDirection="column"
                        height={contentHeight}
                        paddingRight={1}
                    >
                        {fields.map((field) => (
                            <Text key={field.name} wrap="truncate-end">
                                {field.question}: {getDisplayValue(formData[field.name])}
                            </Text>
                        ))}
                    </Box>
                );
            }

            if (!activeField) return null;

            if (activeField.type === 'string' || activeField.type === 'number') {
                return (
                    <Box height={contentHeight}>
                        <Text wrap="truncate-end">
                            <Text color="cyan">&gt; </Text>
                            {currentInput || <Text color="gray">Type your answer…</Text>}
                            <Text color="cyan">▋</Text>
                        </Text>
                    </Box>
                );
            }

            const options: Array<{
                key: string;
                label: string;
                isFocused: boolean;
                isSelected: boolean;
            }> = [];

            if (activeField.type === 'boolean') {
                options.push({
                    key: 'yes',
                    label: 'Yes',
                    isFocused: enumIndex === 0,
                    isSelected: formData[activeField.name] === true,
                });
                options.push({
                    key: 'no',
                    label: 'No',
                    isFocused: enumIndex === 1,
                    isSelected: formData[activeField.name] === false,
                });
            }

            if (
                (activeField.type === 'enum' || activeField.type === 'array-enum') &&
                activeField.enumValues
            ) {
                activeField.enumValues.forEach((opt, i) => {
                    const isFocused = i === enumIndex;
                    const isSelected =
                        activeField.type === 'enum'
                            ? formData[activeField.name] === opt
                            : arraySelections.has(i);
                    options.push({
                        key: `${String(opt)}-${i}`,
                        label: String(opt),
                        isFocused,
                        isSelected,
                    });
                });
            }

            const focusedIndex = Math.max(
                0,
                options.findIndex((o) => o.isFocused)
            );
            const maxScrollTop = Math.max(0, options.length - contentHeight);
            const targetScrollTop = clamp(
                focusedIndex - Math.floor(contentHeight / 2),
                0,
                maxScrollTop
            );

            return (
                <Box
                    overflowY="scroll"
                    overflowX="hidden"
                    scrollbarThumbColor="gray"
                    height={contentHeight}
                    scrollTop={targetScrollTop}
                    flexDirection="column"
                    paddingRight={1}
                >
                    {options.map((opt) => {
                        const prefix = opt.isFocused ? '▶ ' : '  ';
                        const mark =
                            activeField.type === 'array-enum'
                                ? opt.isSelected
                                    ? '[✓] '
                                    : '[ ] '
                                : opt.isSelected
                                  ? '✓ '
                                  : '  ';
                        return (
                            <Text
                                key={opt.key}
                                color={opt.isFocused ? 'cyan' : 'gray'}
                                wrap="truncate-end"
                            >
                                {prefix}
                                {mark}
                                {opt.label}
                            </Text>
                        );
                    })}
                </Box>
            );
        };

        const titleLine = isReviewing ? 'Review your answers' : (activeField?.question ?? '');

        const descriptionLine =
            !isReviewing && activeField?.helpText ? cleanLabel(activeField.helpText) : '';

        const hintLine = (() => {
            if (isReviewing) return 'Enter submit • ← edit • ↑↓ scroll • Esc cancel';
            switch (activeField?.type) {
                case 'string':
                case 'number':
                    return 'Type to answer • Enter next • ←/→ question • Esc cancel';
                case 'array-enum':
                    return '↑/↓ option • Space toggle • Enter next • ←/→ question • Esc cancel';
                default:
                    return '↑/↓ option • Enter select • ←/→ question • Esc cancel';
            }
        })();

        return (
            <Box flexDirection="column" paddingX={0} height={viewportHeight}>
                <Text color="yellowBright" bold wrap="truncate-end" dimColor>
                    📝 {cleanLabel(metadata.prompt)}
                </Text>

                <Box flexDirection="row">
                    <Text color="gray" dimColor wrap="truncate-end">
                        ←{' '}
                    </Text>
                    {stepper.leftEllipsis && (
                        <Text color="gray" dimColor wrap="truncate-end">
                            …{' '}
                        </Text>
                    )}
                    {stepper.items.map((item, i) => (
                        <React.Fragment key={item.key}>
                            {i > 0 && (
                                <Text color="gray" dimColor wrap="truncate-end">
                                    {'  '}
                                </Text>
                            )}
                            {item.active ? (
                                <Text inverse color="white" wrap="truncate-end">
                                    {item.complete ? '✓' : '□'} {item.label}
                                </Text>
                            ) : (
                                <Text color="gray" dimColor wrap="truncate-end">
                                    {item.complete ? '✓' : '□'} {item.label}
                                </Text>
                            )}
                        </React.Fragment>
                    ))}
                    {stepper.rightEllipsis && (
                        <Text color="gray" dimColor wrap="truncate-end">
                            {' '}
                            …
                        </Text>
                    )}
                    <Text color="gray" dimColor wrap="truncate-end">
                        {'  '}
                    </Text>
                    {stepper.submit.active ? (
                        <Text inverse color="white" wrap="truncate-end">
                            {stepper.submit.complete ? '✓' : '□'} Submit
                        </Text>
                    ) : (
                        <Text color="gray" dimColor wrap="truncate-end">
                            {stepper.submit.complete ? '✓' : '□'} Submit
                        </Text>
                    )}
                    <Text color="gray" dimColor wrap="truncate-end">
                        {' '}
                        →
                    </Text>
                </Box>

                <Text color="white" bold wrap="truncate-end">
                    {titleLine}
                    {!isReviewing && activeField?.required && <Text color="red">*</Text>}
                </Text>

                <Text color="gray" dimColor wrap="truncate-end">
                    {descriptionLine || ' '}
                </Text>

                <Text color="red" wrap="truncate-end">
                    {errorText || ' '}
                </Text>

                {renderContent()}

                <Text color="gray" dimColor wrap="truncate-end">
                    {hintLine}
                </Text>
            </Box>
        );
    }
);

ElicitationForm.displayName = 'ElicitationForm';
