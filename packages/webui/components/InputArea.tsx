import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom';
import TextareaAutosize from 'react-textarea-autosize';
import { Button } from './ui/button';
import { ChatInputContainer, ButtonFooter, AttachButton, RecordButton } from './ChatInput';
import ModelPickerModal from './ModelPicker';
import AttachmentPreview from './AttachmentPreview';
import { SendHorizontal, X, Loader2, AlertCircle, Square, Brain } from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';
import { useChatContext } from './hooks/ChatContext';
import { useFontsReady } from './hooks/useFontsReady';
import { cn, filterAndSortResources } from '../lib/utils';
import { useCurrentSessionId, useSessionProcessing } from '@/lib/stores';
import { useCurrentLLM } from './hooks/useCurrentLLM';
import ResourceAutocomplete from './ResourceAutocomplete';
import type { ResourceMetadata as UIResourceMetadata } from '@dexto/core';
import { useResources } from './hooks/useResources';
import SlashCommandAutocomplete from './SlashCommandAutocomplete';
import { isTextPart, isImagePart, isFilePart } from '../types';
import CreatePromptModal from './CreatePromptModal';
import CreateMemoryModal from './CreateMemoryModal';
import { parseSlashInput, splitKeyValueAndPositional } from '../lib/parseSlash';
import { useAnalytics } from '@/lib/analytics/index.js';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { useModelCapabilities } from './hooks/useLLM';
import { useResolvePrompt } from './hooks/usePrompts';
import { useInputHistory } from './hooks/useInputHistory';
import { useQueuedMessages, useRemoveQueuedMessage, useQueueMessage } from './hooks/useQueue';
import { QueuedMessagesDisplay } from './QueuedMessagesDisplay';
import { Attachment, ATTACHMENT_LIMITS } from '../lib/attachment-types.js';
import {
    generateAttachmentId,
    estimateBase64Size,
    formatFileSize,
} from '../lib/attachment-utils.js';

interface InputAreaProps {
    onSend: (content: string, attachments?: Attachment[]) => void;
    isSending?: boolean;
    variant?: 'welcome' | 'chat';
    isSessionsPanelOpen?: boolean;
}

export default function InputArea({
    onSend,
    isSending,
    isSessionsPanelOpen = false,
}: InputAreaProps) {
    const queryClient = useQueryClient();
    const [text, setText] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // NEW: Replace imageData and fileData with attachments array
    const [attachments, setAttachments] = useState<Attachment[]>([]);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const pdfInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);

    // TODO(unify-fonts): Defer autosize until fonts are ready to avoid
    // initial one-line height jump due to font swap metrics. Remove this
    // once the app uses a single font pipeline without swap.
    // Currently it looks like only 'Welcome to Dexto' is using the older font - (checked with chrome dev tools)
    const fontsReady = useFontsReady();

    // Audio recording state
    const [isRecording, setIsRecording] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);

    // Drag-drop state
    const [isDragging, setIsDragging] = useState(false);
    const dragCounterRef = useRef(0); // Track nested drag events

    // Get state from centralized selectors
    const currentSessionId = useCurrentSessionId();
    const processing = useSessionProcessing(currentSessionId);

    // Get actions from ChatContext
    const { cancel } = useChatContext();

    // Get state from stores and hooks
    const { data: currentLLM } = useCurrentLLM(currentSessionId);

    // Input history for Up/Down navigation
    const { invalidateHistory, navigateUp, navigateDown, resetCursor, isBrowsing } =
        useInputHistory(currentSessionId);

    // Queue management
    const { data: queueData } = useQueuedMessages(currentSessionId);
    const { mutate: removeQueuedMessage } = useRemoveQueuedMessage();
    const { mutate: queueMessage } = useQueueMessage();
    const queuedMessages = useMemo(() => queueData?.messages ?? [], [queueData?.messages]);

    // Analytics tracking
    const analytics = useAnalytics();
    const analyticsRef = useRef(analytics);

    // Keep analytics ref up to date to avoid stale closure issues
    useEffect(() => {
        analyticsRef.current = analytics;
    }, [analytics]);

    // LLM selector state
    const [modelSwitchError, setModelSwitchError] = useState<string | null>(null);
    const [fileUploadError, setFileUploadError] = useState<string | null>(null);
    const [supportedFileTypes, setSupportedFileTypes] = useState<string[]>([]);

    // Resources (for @ mention autocomplete)
    const { resources, loading: resourcesLoading, refresh: refreshResources } = useResources();
    const [mentionQuery, setMentionQuery] = useState('');
    const [showMention, setShowMention] = useState(false);
    const [mentionIndex, setMentionIndex] = useState(0);
    const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties | null>(null);

    // Memoize filtered resources to avoid re-sorting on every keypress
    const filteredResources = useMemo(
        () => filterAndSortResources(resources, mentionQuery),
        [resources, mentionQuery]
    );

    const findActiveAtIndex = (value: string, caret: number) => {
        // Walk backwards from caret to find an '@'
        // @ is only valid if:
        // 1. At the start of the message (i === 0), OR
        // 2. Preceded by whitespace
        for (let i = caret - 1; i >= 0; i--) {
            const ch = value[i];
            if (ch === '@') {
                // Check if @ is at start or preceded by whitespace
                if (i === 0) {
                    return i; // @ at start is valid
                }
                const prev = value[i - 1];
                if (/\s/.test(prev)) {
                    return i; // @ after whitespace is valid
                }
                return -1; // @ in middle of text (like email) - ignore
            }
            if (/\s/.test(ch)) break; // stop at whitespace
        }
        return -1;
    };

    // Slash command state
    const [showSlashCommands, setShowSlashCommands] = useState(false);
    const [showCreatePromptModal, setShowCreatePromptModal] = useState(false);
    const [slashRefreshKey, setSlashRefreshKey] = useState(0);

    // Memory state
    const [showCreateMemoryModal, setShowCreateMemoryModal] = useState(false);

    // Prompt resolution mutation
    const resolvePromptMutation = useResolvePrompt();

    const showUserError = (message: string) => {
        setFileUploadError(message);
        // Auto-clear error after 5 seconds
        setTimeout(() => setFileUploadError(null), 5000);
    };

    const openCreatePromptModal = React.useCallback(() => {
        setShowSlashCommands(false);
        setShowCreatePromptModal(true);
    }, []);

    const handlePromptCreated = React.useCallback(
        (prompt: { name: string; arguments?: Array<{ name: string; required?: boolean }> }) => {
            // Manual cache invalidation needed for custom prompt creation (not triggered by SSE events)
            queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all });
            setShowCreatePromptModal(false);
            setSlashRefreshKey((prev) => prev + 1);
            const slashCommand = `/${prompt.name}`;
            setText(slashCommand);
            if (textareaRef.current) {
                textareaRef.current.focus();
                textareaRef.current.setSelectionRange(slashCommand.length, slashCommand.length);
            }
        },
        [queryClient]
    );

    const handleCloseCreatePrompt = React.useCallback(() => {
        setShowCreatePromptModal(false);
        if (text === '/') {
            setText('');
        }
    }, [text]);

    // Fetch model capabilities (supported file types) via dedicated endpoint
    // This handles gateway providers (dexto, openrouter) by resolving to underlying model capabilities
    const { data: capabilities } = useModelCapabilities(currentLLM?.provider, currentLLM?.model);

    // Extract supported file types from capabilities
    useEffect(() => {
        if (capabilities?.supportedFileTypes) {
            setSupportedFileTypes(capabilities.supportedFileTypes);
        } else {
            setSupportedFileTypes([]);
        }
    }, [capabilities]);

    // NOTE: We intentionally do not manually resize the textarea. We rely on
    // CSS max-height + overflow to keep layout stable.

    // Calculate total size of all attachments
    const totalAttachmentsSize = useMemo(() => {
        return attachments.reduce((sum, att) => sum + att.size, 0);
    }, [attachments]);

    const handleSend = async () => {
        let trimmed = text.trim();
        // Allow sending if we have text OR any attachment
        if (!trimmed && attachments.length === 0) return;

        // If slash command typed, resolve to full prompt content at send time
        if (trimmed === '/') {
            openCreatePromptModal();
            return;
        } else if (trimmed.startsWith('/')) {
            const parsed = parseSlashInput(trimmed);
            const name = parsed.command;
            // Preserve original suffix including quotes/spacing (trim only leading space)
            const originalArgsText = trimmed.slice(1 + name.length).trimStart();
            if (name) {
                try {
                    const result = await resolvePromptMutation.mutateAsync({
                        name,
                        context: originalArgsText || undefined,
                        args:
                            parsed.argsArray && parsed.argsArray.length > 0
                                ? (() => {
                                      const { keyValues, positional } = splitKeyValueAndPositional(
                                          parsed.argsArray
                                      );
                                      const argsPayload: Record<string, unknown> = { ...keyValues };
                                      if (positional.length > 0)
                                          argsPayload._positional = positional;
                                      return Object.keys(argsPayload).length > 0
                                          ? JSON.stringify(argsPayload)
                                          : undefined;
                                  })()
                                : undefined,
                    });
                    if (result.text.trim()) {
                        trimmed = result.text;
                    }
                } catch {
                    // keep original
                }
            }
        }

        // Auto-queue: if session is busy processing, queue the message instead of sending
        if (processing && currentSessionId) {
            queueMessage({
                sessionId: currentSessionId,
                message: trimmed || undefined,
                attachments: attachments.length > 0 ? attachments : undefined,
            });
            // Invalidate history cache so it refetches with new message
            invalidateHistory();
            setText('');
            setAttachments([]);
            setShowSlashCommands(false);
            // Keep focus in input for quick follow-up messages
            textareaRef.current?.focus();
            return;
        }

        onSend(trimmed, attachments.length > 0 ? attachments : undefined);
        // Invalidate history cache so it refetches with new message
        invalidateHistory();
        setText('');
        setAttachments([]);
        // Ensure guidance window closes after submit
        setShowSlashCommands(false);
        // Keep focus in input for quick follow-up messages
        textareaRef.current?.focus();
    };

    const applyMentionSelection = (index: number, selectedResource?: UIResourceMetadata) => {
        if (!selectedResource && filteredResources.length === 0) return;
        const selected =
            selectedResource ??
            filteredResources[Math.max(0, Math.min(index, filteredResources.length - 1))];
        const ta = textareaRef.current;
        if (!ta) return;
        const caret = ta.selectionStart ?? text.length;
        const atIndex = findActiveAtIndex(text, caret);
        if (atIndex === -1) return;
        const before = text.slice(0, atIndex);
        const after = text.slice(caret);
        // Mask input with readable name, rely on runtime resolver for expansion
        const name = selected.name || selected.uri.split('/').pop() || selected.uri;
        const insertion = selected.serverName ? `@${selected.serverName}:${name}` : `@${name}`;
        const next = before + insertion + after;
        setText(next);
        setShowMention(false);
        setMentionQuery('');
        setMentionIndex(0);
        // Restore caret after inserted mention
        requestAnimationFrame(() => {
            const pos = (before + insertion).length;
            ta.setSelectionRange(pos, pos);
            ta.focus();
        });
    };

    // Edit a queued message: remove from queue and load into input
    const handleEditQueuedMessage = useCallback(
        (message: (typeof queuedMessages)[number]) => {
            if (!currentSessionId) return;

            // Extract text content from message
            const textContent = message.content
                .filter(isTextPart)
                .map((part) => part.text)
                .join('\n');

            // Extract ALL image parts (multiple images now supported)
            const imageParts = message.content.filter(isImagePart);

            // Extract ALL file parts (multiple files now supported)
            const fileParts = message.content.filter(isFilePart);

            // Convert to Attachment[] format
            const loadedAttachments: Attachment[] = [
                ...imageParts.map((img) => ({
                    id: generateAttachmentId(),
                    type: 'image' as const,
                    data: img.image,
                    mimeType: img.mimeType ?? 'image/jpeg',
                    size: estimateBase64Size(img.image),
                    source: 'button' as const,
                })),
                ...fileParts.map((file) => ({
                    id: generateAttachmentId(),
                    type: 'file' as const,
                    data: file.data,
                    mimeType: file.mimeType,
                    filename: file.filename,
                    size: estimateBase64Size(file.data),
                    source: 'button' as const,
                })),
            ];

            // Load into input
            setText(textContent);
            setAttachments(loadedAttachments);

            // Remove from queue
            removeQueuedMessage({ sessionId: currentSessionId, messageId: message.id });

            // Focus textarea
            textareaRef.current?.focus();
        },
        [currentSessionId, removeQueuedMessage]
    );

    // Handle Up arrow to edit most recent queued message (when input empty/on first line)
    const handleEditLastQueued = useCallback(() => {
        if (queuedMessages.length === 0) return false;

        // Get the most recently queued message (last in array)
        const lastMessage = queuedMessages[queuedMessages.length - 1];
        if (lastMessage) {
            handleEditQueuedMessage(lastMessage);
            return true;
        }
        return false;
    }, [queuedMessages, handleEditQueuedMessage]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // If mention menu open, handle navigation
        if (showMention) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMentionIndex((prev) => (prev + 1) % Math.max(1, filteredResources.length));
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionIndex(
                    (prev) =>
                        (prev - 1 + Math.max(1, filteredResources.length)) %
                        Math.max(1, filteredResources.length)
                );
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                applyMentionSelection(mentionIndex);
                return;
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                applyMentionSelection(mentionIndex);
                return;
            }
            if (e.key === 'Escape') {
                setShowMention(false);
                return;
            }
        }

        // Up: First check queue, then fall back to input history
        // Only handle when cursor is on first line (no newline before cursor)
        if (e.key === 'ArrowUp' && !e.altKey && !e.ctrlKey && !e.metaKey) {
            const cursorPos = textareaRef.current?.selectionStart ?? 0;
            const textBeforeCursor = text.slice(0, cursorPos);
            const isOnFirstLine = !textBeforeCursor.includes('\n');

            if (isOnFirstLine) {
                e.preventDefault();
                // First priority: pop from queue if available
                if (queuedMessages.length > 0) {
                    handleEditLastQueued();
                    return;
                }
                // Second priority: navigate input history
                const historyText = navigateUp(text);
                if (historyText !== null) {
                    setText(historyText);
                    // Move cursor to end
                    requestAnimationFrame(() => {
                        const len = historyText.length;
                        textareaRef.current?.setSelectionRange(len, len);
                    });
                }
                return;
            }
        }

        if (e.key === 'ArrowDown' && !e.altKey && !e.ctrlKey && !e.metaKey) {
            if (isBrowsing) {
                e.preventDefault();
                const historyText = navigateDown();
                if (historyText !== null) {
                    setText(historyText);
                    // Move cursor to end
                    requestAnimationFrame(() => {
                        const len = historyText.length;
                        textareaRef.current?.setSelectionRange(len, len);
                    });
                }
                return;
            }
        }

        // If memory hint is showing, handle Escape to dismiss
        if (showMemoryHint && e.key === 'Escape') {
            e.preventDefault();
            setShowMemoryHint(false);
            setText('');
            return;
        }

        // NEW: Backspace on empty input removes last attachment
        if (e.key === 'Backspace' && !text && attachments.length > 0) {
            e.preventDefault();
            setAttachments((prev) => prev.slice(0, -1));
            return;
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            // Check if user typed `#` to create a memory
            if (text.trim() === '#') {
                setText('');
                setShowMemoryHint(false);
                setShowCreateMemoryModal(true);
                return;
            }
            handleSend();
        }
    };

    // Memory hint state
    const [showMemoryHint, setShowMemoryHint] = useState(false);
    const [memoryHintStyle, setMemoryHintStyle] = useState<React.CSSProperties | null>(null);

    // Handle slash command input
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        setText(value);

        // Reset history browsing when user types
        resetCursor();

        // Guidance UX: keep slash guidance window open while the user is constructing
        // a slash command (i.e., as long as the input starts with '/' and has no newline).
        // This lets users see argument hints while typing positional/named args.
        if (value.startsWith('/') && !value.includes('\n')) {
            setShowSlashCommands(true);
        } else if (showSlashCommands) {
            setShowSlashCommands(false);
        }

        // Show memory hint when user types exactly '#'
        if (value.trim() === '#') {
            setShowMemoryHint(true);
            // Position hint below textarea
            const ta = textareaRef.current;
            if (ta) {
                const anchor = ta.getBoundingClientRect();
                const margin = 16;
                const left = Math.max(8, anchor.left + window.scrollX + margin);
                const maxWidth = Math.max(280, anchor.width - margin * 2);
                const bottomOffset = 64;
                const bottom = Math.max(
                    80,
                    window.innerHeight - (anchor.bottom + window.scrollY) + bottomOffset
                );
                setMemoryHintStyle({
                    position: 'fixed',
                    left,
                    bottom,
                    width: maxWidth,
                    zIndex: 9999,
                });
            }
        } else {
            setShowMemoryHint(false);
            setMemoryHintStyle(null);
        }
    };

    // Handle prompt selection
    const handlePromptSelect = (prompt: {
        name: string;
        arguments?: Array<{ name: string; required?: boolean }>;
    }) => {
        const slash = `/${prompt.name}`;
        setText(slash);
        setShowSlashCommands(false);
        if (textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(slash.length, slash.length);
        }
    };

    const closeSlashCommands = () => {
        setShowSlashCommands(false);
    };

    // Detect @mention context on text change and caret move
    useEffect(() => {
        const ta = textareaRef.current;
        const caret = ta ? (ta.selectionStart ?? text.length) : text.length;
        const atIndex = findActiveAtIndex(text, caret);
        if (atIndex >= 0) {
            const q = text.slice(atIndex + 1, caret);
            setMentionQuery(q);
            setShowMention(true);
            setMentionIndex(0);
            // Compute dropdown viewport position via textarea's bounding rect
            const anchor = ta?.getBoundingClientRect();
            if (anchor) {
                const margin = 16; // inner padding from InputArea
                const left = Math.max(8, anchor.left + window.scrollX + margin);
                const maxWidth = Math.max(280, anchor.width - margin * 2);
                const bottomOffset = 64; // keep above footer area
                const bottom = Math.max(
                    80,
                    window.innerHeight - (anchor.bottom + window.scrollY) + bottomOffset
                );
                setDropdownStyle({
                    position: 'fixed',
                    left,
                    bottom,
                    width: maxWidth,
                    zIndex: 9999,
                });
            }
        } else {
            setShowMention(false);
            setMentionQuery('');
            setDropdownStyle(null);
        }
    }, [text]);

    const mentionActiveRef = React.useRef(false);
    useEffect(() => {
        if (showMention) {
            if (!mentionActiveRef.current) {
                mentionActiveRef.current = true;
                void refreshResources();
            }
        } else {
            mentionActiveRef.current = false;
        }
    }, [showMention, refreshResources]);

    // Large paste guard to prevent layout from exploding with very large text
    const LARGE_PASTE_THRESHOLD = 20000; // characters
    const toBase64 = (str: string) => {
        try {
            return btoa(unescape(encodeURIComponent(str)));
        } catch {
            return btoa(str);
        }
    };

    // Unified file handler for button uploads, paste, and drag-drop
    const handleFilesAdded = async (files: File[], source: 'button' | 'paste' | 'drop') => {
        if (files.length === 0) return;

        const errors: Array<{
            filename: string;
            reason: string;
            compatibleModels?: string[];
        }> = [];

        // 1. Validate file count
        if (attachments.length + files.length > ATTACHMENT_LIMITS.MAX_COUNT) {
            showUserError(
                `Cannot add ${files.length} file(s). Maximum ${ATTACHMENT_LIMITS.MAX_COUNT} attachments allowed (currently ${attachments.length}).`
            );
            return;
        }

        // 2. Validate total size
        const currentTotalSize = attachments.reduce((sum, att) => sum + att.size, 0);
        const newFilesSize = files.reduce((sum, f) => sum + f.size, 0);
        if (currentTotalSize + newFilesSize > ATTACHMENT_LIMITS.MAX_TOTAL_SIZE) {
            showUserError(
                `Total size would exceed ${formatFileSize(ATTACHMENT_LIMITS.MAX_TOTAL_SIZE)}. Current: ${formatFileSize(currentTotalSize)}, Adding: ${formatFileSize(newFilesSize)}.`
            );
            return;
        }

        // 3. Process files
        const validFiles: File[] = [];
        const rejectedFiles: Array<{
            file: File;
            reason: 'size_limit' | 'type_unsupported' | 'duplicate';
        }> = [];

        for (const file of files) {
            // Check individual file size
            if (file.size > ATTACHMENT_LIMITS.MAX_FILE_SIZE) {
                rejectedFiles.push({ file, reason: 'size_limit' });
                errors.push({
                    filename: file.name,
                    reason: `File too large (${formatFileSize(file.size)}). Maximum ${formatFileSize(ATTACHMENT_LIMITS.MAX_FILE_SIZE)} per file.`,
                });
                continue;
            }

            // Check for duplicates (by filename and size)
            const isDuplicate = attachments.some(
                (att) => att.filename === file.name && att.size === file.size
            );
            if (isDuplicate) {
                rejectedFiles.push({ file, reason: 'duplicate' });
                errors.push({
                    filename: file.name,
                    reason: 'File already attached (duplicate name and size).',
                });
                continue;
            }

            // Check file type against supported types
            if (supportedFileTypes.length > 0) {
                const fileCategory = file.type.startsWith('image/')
                    ? 'image'
                    : file.type.startsWith('audio/')
                      ? 'audio'
                      : file.type === 'application/pdf'
                        ? 'pdf'
                        : null;

                const isSupported = fileCategory && supportedFileTypes.includes(fileCategory);

                if (!isSupported) {
                    rejectedFiles.push({ file, reason: 'type_unsupported' });

                    // Find compatible models
                    const compatibleModels: string[] = [];
                    if (catalogData && 'models' in catalogData) {
                        const models = catalogData.models;
                        for (const model of models) {
                            if (fileCategory && model.supportedFileTypes?.includes(fileCategory)) {
                                compatibleModels.push(`${model.provider}/${model.name}`);
                            }
                        }
                    }

                    errors.push({
                        filename: file.name,
                        reason: `File type not supported by current model (${currentLLM?.provider}/${currentLLM?.model}).`,
                        compatibleModels:
                            compatibleModels.length > 0 ? compatibleModels.slice(0, 3) : undefined,
                    });
                    continue;
                }
            }

            validFiles.push(file);
        }

        // 4. Track rejected files
        if (currentSessionId) {
            for (const rejected of rejectedFiles) {
                analyticsRef.current.trackFileRejected({
                    reason: rejected.reason,
                    fileType: rejected.file.type,
                    fileSizeBytes: rejected.file.size,
                    sessionId: currentSessionId,
                });
            }
        }

        // 5. Convert valid files to attachments
        if (validFiles.length > 0) {
            try {
                const newAttachments = await Promise.all(
                    validFiles.map((file) => fileToAttachment(file, source))
                );

                setAttachments((prev) => [...prev, ...newAttachments]);

                // Track successful attachments
                if (currentSessionId) {
                    for (const attachment of newAttachments) {
                        trackAttachment(attachment);
                    }
                }
            } catch (error) {
                showUserError(`Failed to process ${validFiles.length} file(s). Please try again.`);
                console.error('File processing error:', error);
            }
        }

        // 6. Show error summary if any files were rejected
        if (errors.length > 0) {
            setFileUploadError(
                errors.length === 1
                    ? `${errors[0].filename}: ${errors[0].reason}${errors[0].compatibleModels ? ` Try: ${errors[0].compatibleModels.join(', ')}` : ''}`
                    : `${errors.length} file(s) rejected. Check file types and sizes.`
            );
        }
    };

    const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const clipboardData = e.clipboardData;

        // Priority 1: Check for files (files copied from file manager or screenshots)
        const files = Array.from(clipboardData.files);
        if (files.length > 0) {
            e.preventDefault();
            await handleFilesAdded(files, 'paste');
            return;
        }

        // Priority 2: Check for image data items (some browsers expose images as items)
        const items = Array.from(clipboardData.items);
        const imageItems = items.filter((item) => item.type.startsWith('image/'));
        if (imageItems.length > 0) {
            e.preventDefault();
            const imageFiles = imageItems
                .map((item) => item.getAsFile())
                .filter((f): f is File => f !== null);
            if (imageFiles.length > 0) {
                await handleFilesAdded(imageFiles, 'paste');
            }
            return;
        }

        // Priority 3: Large text paste guard
        const pasted = clipboardData.getData('text/plain');
        if (!pasted) return;
        if (pasted.length <= LARGE_PASTE_THRESHOLD) return;

        e.preventDefault();
        const attach = window.confirm(
            'Large text detected. Attach as a file instead of inflating the input?\n(OK = attach as file, Cancel = paste truncated preview)'
        );
        if (attach) {
            // Calculate actual byte size using UTF-8 encoding
            const textBytes = new TextEncoder().encode(pasted);
            const byteSize = textBytes.length;

            // Validate against attachment limits BEFORE creating attachment
            // 1. Check attachment count
            if (attachments.length >= ATTACHMENT_LIMITS.MAX_COUNT) {
                showUserError(
                    `Cannot attach pasted text. Maximum ${ATTACHMENT_LIMITS.MAX_COUNT} attachments allowed (currently ${attachments.length}).`
                );
                return;
            }

            // 2. Check individual file size
            if (byteSize > ATTACHMENT_LIMITS.MAX_FILE_SIZE) {
                showUserError(
                    `Pasted text is too large (${formatFileSize(byteSize)}). Maximum ${formatFileSize(ATTACHMENT_LIMITS.MAX_FILE_SIZE)} per file.`
                );
                return;
            }

            // 3. Check total size
            const currentTotalSize = attachments.reduce((sum, att) => sum + att.size, 0);
            if (currentTotalSize + byteSize > ATTACHMENT_LIMITS.MAX_TOTAL_SIZE) {
                showUserError(
                    `Total size would exceed ${formatFileSize(ATTACHMENT_LIMITS.MAX_TOTAL_SIZE)}. Current: ${formatFileSize(currentTotalSize)}, Adding: ${formatFileSize(byteSize)}.`
                );
                return;
            }

            // All validations passed - create attachment
            const attachment: Attachment = {
                id: generateAttachmentId(),
                type: 'file',
                data: toBase64(pasted),
                mimeType: 'text/plain',
                filename: 'pasted.txt',
                size: byteSize, // Use actual byte size, not character count
                source: 'paste',
            };
            setAttachments((prev) => [...prev, attachment]);
        } else {
            const preview = pasted.slice(0, LARGE_PASTE_THRESHOLD);
            setText((prev) => prev + preview);
        }
    };

    // Helper: Convert File to Attachment
    const fileToAttachment = async (
        file: File,
        source: 'button' | 'paste' | 'drop'
    ): Promise<Attachment> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                try {
                    const result = reader.result;

                    // Validate that result is a string
                    if (typeof result !== 'string') {
                        reject(new Error('Malformed data URL: FileReader result is not a string'));
                        return;
                    }

                    // Validate that comma exists in data URL format (data:mime/type;base64,data)
                    const commaIndex = result.indexOf(',');
                    if (commaIndex === -1) {
                        reject(new Error('Malformed data URL: missing comma separator'));
                        return;
                    }

                    const data = result.substring(commaIndex + 1);

                    const attachment: Attachment = {
                        id: generateAttachmentId(),
                        type: file.type.startsWith('image/') ? 'image' : 'file',
                        data,
                        mimeType: file.type,
                        filename: file.name,
                        size: file.size,
                        source,
                    };
                    resolve(attachment);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    };

    // Handle remove attachment
    const handleRemoveAttachment = (id: string) => {
        setAttachments((prev) => prev.filter((att) => att.id !== id));
    };

    // Track attachment analytics
    const trackAttachment = (attachment: Attachment) => {
        if (!currentSessionId) return;

        if (attachment.type === 'image') {
            analyticsRef.current.trackImageAttached({
                imageType: attachment.mimeType,
                imageSizeBytes: attachment.size,
                sessionId: currentSessionId,
            });
        } else {
            analyticsRef.current.trackFileAttached({
                fileType: attachment.mimeType,
                fileSizeBytes: attachment.size,
                sessionId: currentSessionId,
            });
        }
    };

    const handlePdfChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        await handleFilesAdded(files, 'button');
        e.target.value = '';
    };

    // Audio Recording Handlers
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            const chunks: BlobPart[] = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) chunks.push(event.data);
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
                const reader = new FileReader();
                reader.onloadend = () => {
                    try {
                        const result = reader.result as string;
                        const commaIndex = result.indexOf(',');
                        const data = result.substring(commaIndex + 1);
                        // Preserve original MIME type and determine appropriate extension
                        const mimeType = mediaRecorder.mimeType || 'audio/webm';
                        const getExtensionFromMime = (mime: string): string => {
                            const mimeToExt: Record<string, string> = {
                                'audio/mp3': 'mp3',
                                'audio/mpeg': 'mp3',
                                'audio/wav': 'wav',
                                'audio/x-wav': 'wav',
                                'audio/wave': 'wav',
                                'audio/webm': 'webm',
                                'audio/ogg': 'ogg',
                                'audio/m4a': 'm4a',
                                'audio/aac': 'aac',
                            };
                            return mimeToExt[mime] || mime.split('/')[1] || 'webm';
                        };
                        const ext = getExtensionFromMime(mimeType);

                        const attachment: Attachment = {
                            id: generateAttachmentId(),
                            type: 'file',
                            data,
                            mimeType,
                            filename: `recording.${ext}`,
                            size: blob.size,
                            source: 'button',
                        };

                        setAttachments((prev) => [...prev, attachment]);
                        trackAttachment(attachment);
                    } catch {
                        showUserError('Failed to process audio recording. Please try again.');
                    }
                };
                reader.readAsDataURL(blob);

                // Stop all tracks to release microphone
                stream.getTracks().forEach((track) => track.stop());
            };

            mediaRecorder.start();
            setIsRecording(true);
        } catch {
            showUserError('Failed to start audio recording. Please check microphone permissions.');
        }
    };

    const stopRecording = () => {
        mediaRecorderRef.current?.stop();
        setIsRecording(false);
    };

    const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        await handleFilesAdded(files, 'button');
        e.target.value = '';
    };

    const triggerFileInput = () => fileInputRef.current?.click();
    const triggerPdfInput = () => pdfInputRef.current?.click();
    const triggerAudioInput = () => audioInputRef.current?.click();

    // Clear model switch error when user starts typing
    useEffect(() => {
        if (text && modelSwitchError) {
            setModelSwitchError(null);
        }
        if (text && fileUploadError) {
            setFileUploadError(null);
        }
    }, [text, modelSwitchError, fileUploadError]);

    const handleAudioFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        await handleFilesAdded(files, 'button');
        e.target.value = '';
    };

    // Drag event handlers
    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current++;
        if (e.dataTransfer.types.includes('Files')) {
            setIsDragging(true);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) {
            setIsDragging(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        dragCounterRef.current = 0;

        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            await handleFilesAdded(files, 'drop');
        }
    };

    // Keyboard handler for accessibility - allows keyboard users to activate file picker
    const handleDropZoneKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            // Trigger the first available file input for keyboard users
            fileInputRef.current?.click();
        }
    };

    // Unified input panel: use the same full-featured chat composer in both welcome and chat states

    // Chat variant - full featured input area
    return (
        <div id="input-area" className="flex flex-col gap-2 w-full">
            {/* Model Switch Error Alert */}
            {modelSwitchError && (
                <Alert variant="destructive" className="mb-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="flex items-center justify-between">
                        <span>{modelSwitchError}</span>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setModelSwitchError(null)}
                            className="h-auto p-1 ml-2"
                        >
                            <X className="h-3 w-3" />
                        </Button>
                    </AlertDescription>
                </Alert>
            )}

            {/* File Upload Error Alert */}
            {fileUploadError && (
                <Alert variant="destructive" className="mb-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="flex items-center justify-between">
                        <span>{fileUploadError}</span>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setFileUploadError(null)}
                            className="h-auto p-1 ml-2"
                        >
                            <X className="h-3 w-3" />
                        </Button>
                    </AlertDescription>
                </Alert>
            )}

            <div className="w-full">
                {/* Unified pill input with send button */}
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        handleSend();
                    }}
                >
                    <div
                        role="region"
                        aria-label="Message input area with file drop zone. Press Enter or Space to select files"
                        tabIndex={0}
                        className={cn(
                            'relative transition-all duration-200',
                            isDragging && 'ring-2 ring-primary ring-offset-2 rounded-lg'
                        )}
                        onDragEnter={handleDragEnter}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onKeyDown={handleDropZoneKeyDown}
                    >
                        <ChatInputContainer>
                            {/* Drop overlay with visual feedback */}
                            {isDragging && (
                                <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 rounded-lg pointer-events-none">
                                    <div className="text-center">
                                        <div className="text-4xl mb-2">📎</div>
                                        <p className="text-sm font-medium text-primary">
                                            Drop files to attach
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Up to {ATTACHMENT_LIMITS.MAX_COUNT} files,{' '}
                                            {formatFileSize(ATTACHMENT_LIMITS.MAX_FILE_SIZE)} each
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Queued messages display (shows when messages are pending) */}
                            {queuedMessages.length > 0 && (
                                <QueuedMessagesDisplay
                                    messages={queuedMessages}
                                    onEditMessage={handleEditQueuedMessage}
                                    onRemoveMessage={(messageId) => {
                                        if (currentSessionId) {
                                            removeQueuedMessage({
                                                sessionId: currentSessionId,
                                                messageId,
                                            });
                                        }
                                    }}
                                />
                            )}

                            {/* Attachments strip (inside bubble, above editor) */}
                            {attachments.length > 0 && (
                                <div className="px-4 pt-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="text-xs text-muted-foreground">
                                            {attachments.length} / {ATTACHMENT_LIMITS.MAX_COUNT}{' '}
                                            files ({formatFileSize(totalAttachmentsSize)} /{' '}
                                            {formatFileSize(ATTACHMENT_LIMITS.MAX_TOTAL_SIZE)})
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setAttachments([])}
                                            className="h-6 text-xs text-muted-foreground hover:text-destructive"
                                        >
                                            Clear all
                                        </Button>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {attachments.map((attachment) => (
                                            <AttachmentPreview
                                                key={attachment.id}
                                                attachment={attachment}
                                                onRemove={() =>
                                                    handleRemoveAttachment(attachment.id)
                                                }
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Editor area: scrollable, independent from footer */}
                            <div className="flex-auto overflow-y-auto relative">
                                {fontsReady ? (
                                    <TextareaAutosize
                                        ref={textareaRef}
                                        value={text}
                                        onChange={handleInputChange}
                                        onKeyDown={handleKeyDown}
                                        onPaste={handlePaste}
                                        placeholder="Ask Dexto anything... Type @ for resources, / for prompts, # for memories"
                                        minRows={1}
                                        maxRows={8}
                                        className="w-full px-4 pt-4 pb-1 text-lg leading-7 placeholder:text-lg bg-transparent border-none resize-none outline-none ring-0 ring-offset-0 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none max-h-full"
                                    />
                                ) : (
                                    <textarea
                                        ref={textareaRef}
                                        rows={1}
                                        value={text}
                                        onChange={handleInputChange}
                                        onKeyDown={handleKeyDown}
                                        onPaste={handlePaste}
                                        placeholder="Ask Dexto anything... Type @ for resources, / for prompts, # for memories"
                                        className="w-full px-4 pt-4 pb-1 text-lg leading-7 placeholder:text-lg bg-transparent border-none resize-none outline-none ring-0 ring-offset-0 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none"
                                    />
                                )}

                                {showMention &&
                                    dropdownStyle &&
                                    typeof window !== 'undefined' &&
                                    ReactDOM.createPortal(
                                        <div
                                            style={dropdownStyle}
                                            className="max-h-64 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md"
                                        >
                                            <ResourceAutocomplete
                                                resources={resources}
                                                query={mentionQuery}
                                                selectedIndex={mentionIndex}
                                                onHoverIndex={(i) => setMentionIndex(i)}
                                                onSelect={(r) =>
                                                    applyMentionSelection(mentionIndex, r)
                                                }
                                                loading={resourcesLoading}
                                            />
                                        </div>,
                                        document.body
                                    )}

                                {showMemoryHint &&
                                    memoryHintStyle &&
                                    typeof window !== 'undefined' &&
                                    ReactDOM.createPortal(
                                        <div
                                            style={memoryHintStyle}
                                            className="rounded-md border border-border bg-popover text-popover-foreground shadow-md"
                                        >
                                            <div className="p-2 flex items-center gap-2 text-sm text-muted-foreground">
                                                <Brain className="h-3.5 w-3.5" />
                                                <span>
                                                    Press{' '}
                                                    <kbd className="px-1.5 py-0.5 text-xs bg-muted border border-border rounded">
                                                        Enter
                                                    </kbd>{' '}
                                                    to create a memory
                                                </span>
                                            </div>
                                        </div>,
                                        document.body
                                    )}
                            </div>

                            {/* Slash command autocomplete overlay (inside container to anchor positioning) */}
                            <SlashCommandAutocomplete
                                isVisible={showSlashCommands}
                                searchQuery={text}
                                onSelectPrompt={handlePromptSelect}
                                onClose={closeSlashCommands}
                                onCreatePrompt={openCreatePromptModal}
                                refreshKey={slashRefreshKey}
                            />

                            {/* Footer row: normal flow */}
                            <ButtonFooter
                                leftButtons={
                                    <div className="flex items-center gap-2">
                                        <AttachButton
                                            onImageAttach={triggerFileInput}
                                            onPdfAttach={triggerPdfInput}
                                            onAudioAttach={triggerAudioInput}
                                            supports={{
                                                // If not yet loaded (length===0), pass undefined so AttachButton defaults to enabled
                                                image: supportedFileTypes.length
                                                    ? supportedFileTypes.includes('image')
                                                    : undefined,
                                                pdf: supportedFileTypes.length
                                                    ? supportedFileTypes.includes('pdf')
                                                    : undefined,
                                                audio: supportedFileTypes.length
                                                    ? supportedFileTypes.includes('audio')
                                                    : undefined,
                                            }}
                                            useLargeBreakpoint={isSessionsPanelOpen}
                                        />

                                        <RecordButton
                                            isRecording={isRecording}
                                            onToggleRecording={
                                                isRecording ? stopRecording : startRecording
                                            }
                                            disabled={
                                                supportedFileTypes.length > 0 &&
                                                !supportedFileTypes.includes('audio')
                                            }
                                            useLargeBreakpoint={isSessionsPanelOpen}
                                        />
                                    </div>
                                }
                                rightButtons={
                                    <div className="flex items-center gap-2">
                                        <ModelPickerModal />

                                        {/* Stop/Cancel button shown when a run is in progress */}
                                        <Button
                                            type={processing ? 'button' : 'submit'}
                                            onClick={
                                                processing
                                                    ? () => cancel(currentSessionId || undefined)
                                                    : undefined
                                            }
                                            disabled={
                                                processing
                                                    ? false
                                                    : (!text.trim() && attachments.length === 0) ||
                                                      isSending
                                            }
                                            className={cn(
                                                'h-10 w-10 p-0 rounded-full transition-all duration-200',
                                                processing
                                                    ? 'bg-secondary/80 text-secondary-foreground hover:bg-secondary shadow-sm hover:shadow-md border border-border/50'
                                                    : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm hover:shadow-lg'
                                            )}
                                            aria-label={processing ? 'Stop' : 'Send message'}
                                            title={processing ? 'Stop' : 'Send'}
                                        >
                                            {processing ? (
                                                <Square className="h-3.5 w-3.5 fill-current" />
                                            ) : isSending ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <SendHorizontal className="h-4 w-4" />
                                            )}
                                        </Button>
                                    </div>
                                }
                            />
                        </ChatInputContainer>
                    </div>
                </form>

                {/* Previews moved inside bubble above editor */}

                {/* Hidden inputs */}
                <input
                    ref={fileInputRef}
                    type="file"
                    id="image-upload"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageChange}
                />
                <input
                    ref={pdfInputRef}
                    type="file"
                    id="pdf-upload"
                    accept="application/pdf"
                    multiple
                    className="hidden"
                    onChange={handlePdfChange}
                />
                <input
                    ref={audioInputRef}
                    type="file"
                    id="audio-upload"
                    accept="audio/*"
                    multiple
                    className="hidden"
                    onChange={handleAudioFileChange}
                />

                <CreatePromptModal
                    open={showCreatePromptModal}
                    onClose={handleCloseCreatePrompt}
                    onCreated={handlePromptCreated}
                />

                <CreateMemoryModal
                    open={showCreateMemoryModal}
                    onClose={() => setShowCreateMemoryModal(false)}
                />
            </div>
        </div>
    );
}
