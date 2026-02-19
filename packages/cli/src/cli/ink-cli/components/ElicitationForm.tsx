/**
 * ElicitationForm Component
 * Renders a form for ask_user/elicitation requests in the CLI.
 *
 * Uses a wizard flow (one question at a time) to avoid huge modals and improve
 * usability on small terminals.
 */

import React, { useState, forwardRef, useImperativeHandle, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import wrapAnsi from 'wrap-ansi';
import type { ElicitationMetadata } from '@dexto/core';
import type { Key } from '../hooks/useInputOrchestrator.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { parseElicitationSchema, type ElicitationFormField } from '../utils/elicitationSchema.js';

export interface ElicitationFormHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ElicitationFormProps {
    metadata: ElicitationMetadata;
    onSubmit: (formData: Record<string, unknown>) => void;
    onCancel: () => void;
}

function hasOwn(obj: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function getDisplayValue(value: unknown): string {
    if (value === undefined || value === null || value === '') return '—';
    if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—';
    if (value === true) return 'Yes';
    if (value === false) return 'No';
    return String(value ?? '');
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

        const headerLineCount = 1;
        const stepHeaderLineCount = 2; // hard cap: 2 lines
        const spacerAfterStepLineCount = 1;
        const questionLineCount = 2;
        const helpLineCount = 2;
        const errorLineCount = 1;

        const questionHeaderHeight =
            headerLineCount +
            stepHeaderLineCount +
            spacerAfterStepLineCount +
            questionLineCount +
            helpLineCount +
            errorLineCount;

        const reviewHeaderHeight = headerLineCount + spacerAfterStepLineCount;

        const maxHeaderHeight = Math.max(questionHeaderHeight, reviewHeaderHeight);
        const footerHeight = 1; // key hints
        const minContentHeight = 4;

        const viewportHeight = useMemo(() => {
            // Ink clears + redraws when dynamic output height >= terminal rows, which looks like flicker.
            // Keep the elicitation UI small and scroll internally to stay under that threshold.
            // Leave slack so Ink doesn't hit the "clear + redraw everything" path.
            // (Ink clears when dynamic output height >= terminal rows.)
            const reservedRows = 8;
            const minViewportHeight = maxHeaderHeight + footerHeight + minContentHeight;
            const maxHeight = Math.max(minViewportHeight, terminalRows - reservedRows);
            const desired = Math.max(minViewportHeight, Math.floor(terminalRows * 0.6));
            return Math.min(maxHeight, desired);
        }, [footerHeight, maxHeaderHeight, minContentHeight, terminalRows]);

        const availableWidth = Math.max(20, terminalColumns - 2);

        const fields = useMemo(() => {
            return parseElicitationSchema(metadata.schema);
        }, [metadata.schema]);

        const wrapClampedLines = useCallback(
            (text: string, maxLines: number): string[] => {
                if (maxLines <= 0) return [];
                const wrapped = wrapAnsi(text, availableWidth, {
                    hard: true,
                    wordWrap: true,
                    trim: false,
                });
                const rawLines = wrapped.length > 0 ? wrapped.split('\n') : [''];
                const didTruncate = rawLines.length > maxLines;
                const lines = rawLines.slice(0, maxLines);

                if (didTruncate && lines.length > 0) {
                    const lastIndex = lines.length - 1;
                    const lastLine = (lines[lastIndex] ?? '').replace(/\s+$/, '');
                    const safe =
                        lastLine.length > 0
                            ? `${lastLine.slice(0, Math.max(0, lastLine.length - 1))}…`
                            : '…';
                    lines[lastIndex] = safe;
                }

                while (lines.length < maxLines) {
                    lines.push('');
                }
                return lines;
            },
            [availableWidth]
        );

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

        const contentHeight = useMemo(() => {
            const activeHeaderHeight = isReviewing ? reviewHeaderHeight : questionHeaderHeight;
            return Math.max(1, viewportHeight - activeHeaderHeight - footerHeight);
        }, [footerHeight, isReviewing, questionHeaderHeight, reviewHeaderHeight, viewportHeight]);

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
                    const currentValue = data[field.name];
                    setEnumIndex(currentValue === false ? 1 : 0);
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
                                setEnumIndex((prev) => clamp(prev - 1, 0, 1));
                                return true;
                            }
                            if (key.downArrow) {
                                setEnumIndex((prev) => clamp(prev + 1, 0, 1));
                                return true;
                            }
                            if (input === ' ') {
                                setEnumIndex((prev) => (prev === 0 ? 1 : 0));
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

        const isAnswered = (field: ElicitationFormField): boolean => {
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
                    isSelected: false,
                });
                options.push({
                    key: 'no',
                    label: 'No',
                    isFocused: enumIndex === 1,
                    isSelected: false,
                });
            }

            if (
                (activeField.type === 'enum' || activeField.type === 'array-enum') &&
                activeField.enumValues
            ) {
                activeField.enumValues.forEach((opt, i) => {
                    const isFocused = i === enumIndex;
                    const isSelected = activeField.type === 'enum' ? false : arraySelections.has(i);
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
                                : '';
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

        const hintLine = (() => {
            if (isReviewing) return 'Enter submit • Backspace/← edit • ↑↓ scroll • Esc cancel';
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

        const headerText = isReviewing
            ? '📝 Review your answers'
            : `📝 Please answer these ${fields.length} ${
                  fields.length === 1 ? 'question' : 'questions'
              }.`;

        const stepText = (() => {
            if (isReviewing) {
                return '';
            }
            if (!activeField) return '';
            return `Question ${activeFieldIndex + 1}/${fields.length}: ${activeField.stepLabel}`;
        })();

        const questionText =
            !isReviewing && activeField
                ? `${activeField.question}${activeField.required ? '*' : ''}`
                : '';

        const helpText = !isReviewing && activeField?.helpText ? activeField.helpText : '';
        const errorLineText = !isReviewing ? errorText : '';

        const headerLines = wrapClampedLines(headerText, headerLineCount);
        const stepLines = wrapClampedLines(stepText, stepHeaderLineCount);
        const questionLines = wrapClampedLines(questionText, questionLineCount);
        const helpLines = wrapClampedLines(helpText, helpLineCount);
        const errorLines = wrapClampedLines(errorLineText, errorLineCount);

        return (
            <Box flexDirection="column" paddingX={0} height={viewportHeight}>
                {headerLines.map((line, index) => (
                    <Text key={`header-${index}`} color="yellowBright" bold wrap="truncate-end">
                        {line || ' '}
                    </Text>
                ))}

                {!isReviewing &&
                    stepLines.map((line, index) => (
                        <Text key={`step-${index}`} color="gray" dimColor wrap="truncate-end">
                            {line || ' '}
                        </Text>
                    ))}

                {Array.from({ length: spacerAfterStepLineCount }, (_, index) => (
                    <Text key={`spacer-step-${index}`} wrap="truncate-end">
                        {' '}
                    </Text>
                ))}

                {!isReviewing &&
                    questionLines.map((line, index) => (
                        <Text key={`question-${index}`} color="white" bold wrap="truncate-end">
                            {line || ' '}
                        </Text>
                    ))}

                {!isReviewing &&
                    helpLines.map((line, index) => (
                        <Text key={`help-${index}`} color="gray" dimColor wrap="truncate-end">
                            {line || ' '}
                        </Text>
                    ))}

                {!isReviewing &&
                    errorLines.map((line, index) => (
                        <Text key={`error-${index}`} color="red" wrap="truncate-end">
                            {line || ' '}
                        </Text>
                    ))}

                {renderContent()}

                <Text color="gray" dimColor wrap="truncate-end">
                    {hintLine}
                </Text>
            </Box>
        );
    }
);

ElicitationForm.displayName = 'ElicitationForm';
