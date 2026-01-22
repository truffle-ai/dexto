import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom';
import TextareaAutosize from 'react-textarea-autosize';
import { Button } from './ui/button';
import { ChatInputContainer, ButtonFooter, AttachButton, RecordButton } from './ChatInput';
import ModelPickerModal from './ModelPicker';
import {
    SendHorizontal,
    X,
    Loader2,
    AlertCircle,
    Square,
    FileAudio,
    File,
    Brain,
    Upload,
} from 'lucide-react';
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
import { useLLMCatalog } from './hooks/useLLM';
import { useResolvePrompt } from './hooks/usePrompts';
import { useInputHistory } from './hooks/useInputHistory';
import { useQueuedMessages, useRemoveQueuedMessage, useQueueMessage } from './hooks/useQueue';
import { QueuedMessagesDisplay } from './QueuedMessagesDisplay';

interface InputAreaProps {
    onSend: (
        content: string,
        imageData?: { image: string; mimeType: string },
        fileData?: { data: string; mimeType: string; filename?: string }
    ) => void;
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
    const [imageData, setImageData] = useState<{ image: string; mimeType: string } | null>(null);
    const [fileData, setFileData] = useState<{
        data: string;
        mimeType: string;
        filename?: string;
    } | null>(null);
    const [isDragging, setIsDragging] = useState<boolean>(false);

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

    // File size limit (64MB)
    const MAX_FILE_SIZE = 64 * 1024 * 1024; // 64MB in bytes

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

    // Fetch supported file types for the active model to drive Attach menu
    const { data: catalogData } = useLLMCatalog({ mode: 'flat' });

    // Extract supported file types for the current model
    useEffect(() => {
        const provider = currentLLM?.provider;
        const model = currentLLM?.model;
        if (!provider || !model || !catalogData) {
            setSupportedFileTypes([]);
            return;
        }
        // Type guard: flat mode returns { models: [...] }
        if (!('models' in catalogData)) {
            setSupportedFileTypes([]);
            return;
        }
        const models = catalogData.models;
        const match = models.find((m) => m.provider === provider && m.name === model);
        setSupportedFileTypes(match?.supportedFileTypes || []);
    }, [currentLLM?.provider, currentLLM?.model, catalogData]);

    // NOTE: We intentionally do not manually resize the textarea. We rely on
    // CSS max-height + overflow to keep layout stable.

    const handleSend = async () => {
        let trimmed = text.trim();
        // Allow sending if we have text OR any attachment
        if (!trimmed && !imageData && !fileData) return;

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
                imageData: imageData ?? undefined,
                fileData: fileData ?? undefined,
            });
            // Invalidate history cache so it refetches with new message
            invalidateHistory();
            setText('');
            setImageData(null);
            setFileData(null);
            setShowSlashCommands(false);
            // Keep focus in input for quick follow-up messages
            textareaRef.current?.focus();
            return;
        }

        onSend(trimmed, imageData ?? undefined, fileData ?? undefined);
        // Invalidate history cache so it refetches with new message
        invalidateHistory();
        setText('');
        setImageData(null);
        setFileData(null);
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

            // Extract image attachment if present
            const imagePart = message.content.find(isImagePart);

            // Extract file attachment if present
            const filePart = message.content.find(isFilePart);

            // Load into input
            setText(textContent);
            setImageData(
                imagePart
                    ? { image: imagePart.image, mimeType: imagePart.mimeType ?? 'image/jpeg' }
                    : null
            );
            setFileData(
                filePart
                    ? {
                          data: filePart.data,
                          mimeType: filePart.mimeType,
                          filename: filePart.filename,
                      }
                    : null
            );

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
    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        handleFilePaste(e);
        const pasted = e.clipboardData.getData('text/plain');
        if (!pasted) return;
        if (pasted.length <= LARGE_PASTE_THRESHOLD) return;
        e.preventDefault();
        const attach = window.confirm(
            'Large text detected. Attach as a file instead of inflating the input?\n(OK = attach as file, Cancel = paste truncated preview)'
        );
        if (attach) {
            setFileData({
                data: toBase64(pasted),
                mimeType: 'text/plain',
                filename: 'pasted.txt',
            });
        } else {
            const preview = pasted.slice(0, LARGE_PASTE_THRESHOLD);
            setText((prev) => prev + preview);
        }
    };

    const handleFilePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            if (item.type.indexOf('image') !== -1) {
                e.preventDefault();

                const file = item.getAsFile();
                if (file) {
                    handlePasteImageFile(file);
                }
                return;
            }

            if (item.type === 'application/pdf') {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    handleFile(file);
                }
                return;
            }
        }
    };

    const handlePdfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // File size validation
        if (file.size > MAX_FILE_SIZE) {
            showUserError('PDF file too large. Maximum size is 64MB.');
            e.target.value = '';
            return;
        }

        if (file.type !== 'application/pdf') {
            showUserError('Please select a valid PDF file.');
            e.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            try {
                const result = reader.result as string;
                const commaIndex = result.indexOf(',');
                const data = result.substring(commaIndex + 1);
                setFileData({ data, mimeType: 'application/pdf', filename: file.name });
                setFileUploadError(null); // Clear any previous errors

                // Track file upload
                if (currentSessionId) {
                    analyticsRef.current.trackFileAttached({
                        fileType: 'application/pdf',
                        fileSizeBytes: file.size,
                        sessionId: currentSessionId,
                    });
                }
            } catch {
                showUserError('Failed to process PDF file. Please try again.');
                setFileData(null);
            }
        };
        reader.onerror = () => {
            showUserError('Failed to read PDF file. Please try again.');
            setFileData(null);
        };
        reader.readAsDataURL(file);
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

                        setFileData({
                            data,
                            mimeType: mimeType,
                            filename: `recording.${ext}`,
                        });

                        // Track audio recording upload
                        if (currentSessionId) {
                            analyticsRef.current.trackFileAttached({
                                fileType: mimeType,
                                fileSizeBytes: blob.size,
                                sessionId: currentSessionId,
                            });
                        }
                    } catch {
                        showUserError('Failed to process audio recording. Please try again.');
                        setFileData(null);
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

    const handlePasteImageFile = (file: File) => {
        if (file.size > MAX_FILE_SIZE) {
            showUserError('Image file too large. Maximum size is 64MB.');
            return;
        }

        if (!file.type.startsWith('image/')) {
            showUserError('Please select a valid image file.');
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            try {
                const result = reader.result as string;
                const commaIndex = result.indexOf(',');
                if (commaIndex === -1) throw new Error('Invalid Data URL format');

                const meta = result.substring(0, commaIndex);
                const image = result.substring(commaIndex + 1);

                const mimeMatch = meta.match(/data:(.*);base64/);
                const mimeType = mimeMatch ? mimeMatch[1] : file.type;

                if (!mimeType) throw new Error('Could not determine MIME type');

                setImageData({ image, mimeType });
                setFileUploadError(null); // Clear any previous errors

                // Track image upload
                if (currentSessionId) {
                    analyticsRef.current.trackImageAttached({
                        imageType: mimeType,
                        imageSizeBytes: file.size,
                        sessionId: currentSessionId,
                    });
                }
            } catch {
                showUserError('Failed to process image file. Please try again.');
                setImageData(null);
            }
        };
        reader.onerror = () => {
            showUserError('Failed to read image file. Please try again.');
            setImageData(null);
        };
        reader.readAsDataURL(file);
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // File size validation
        if (file.size > MAX_FILE_SIZE) {
            showUserError('Image file too large. Maximum size is 64MB.');
            e.target.value = '';
            return;
        }

        if (!file.type.startsWith('image/')) {
            showUserError('Please select a valid image file.');
            e.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            try {
                const result = reader.result as string;
                const commaIndex = result.indexOf(',');
                if (commaIndex === -1) throw new Error('Invalid Data URL format');

                const meta = result.substring(0, commaIndex);
                const image = result.substring(commaIndex + 1);

                const mimeMatch = meta.match(/data:(.*);base64/);
                const mimeType = mimeMatch ? mimeMatch[1] : file.type;

                if (!mimeType) throw new Error('Could not determine MIME type');

                setImageData({ image, mimeType });
                setFileUploadError(null); // Clear any previous errors

                // Track image upload
                if (currentSessionId) {
                    analyticsRef.current.trackImageAttached({
                        imageType: mimeType,
                        imageSizeBytes: file.size,
                        sessionId: currentSessionId,
                    });
                }
            } catch {
                showUserError('Failed to process image file. Please try again.');
                setImageData(null);
            }
        };
        reader.onerror = () => {
            showUserError('Failed to read image file. Please try again.');
            setImageData(null);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    const handleFile = (file: File) => {
        // File size validation
        if (file.size > MAX_FILE_SIZE) {
            showUserError('PDF file too large. Maximum size is 64MB.');
            return;
        }

        if (file.type !== 'application/pdf') {
            showUserError('Please select a valid PDF file.');
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            try {
                const result = reader.result as string;
                const commaIndex = result.indexOf(',');
                const data = result.substring(commaIndex + 1);
                setFileData({ data, mimeType: 'application/pdf', filename: file.name });
                setFileUploadError(null);

                if (currentSessionId) {
                    analyticsRef.current.trackFileAttached({
                        fileType: 'application/pdf',
                        fileSizeBytes: file.size,
                        sessionId: currentSessionId,
                    });
                }
            } catch {
                showUserError('Failed to process PDF file. Please try again.');
                setFileData(null);
            }
        };
        reader.onerror = () => {
            showUserError('Failed to read PDF file. Please try again.');
            setFileData(null);
        };
        reader.readAsDataURL(file);
    };

    const removeImage = () => setImageData(null);

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

    const handleAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // File size validation
        if (file.size > MAX_FILE_SIZE) {
            showUserError('Audio file too large. Maximum size is 64MB.');
            e.target.value = '';
            return;
        }

        if (!file.type.startsWith('audio/')) {
            showUserError('Please select a valid audio file.');
            e.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            try {
                const result = reader.result as string;
                const commaIndex = result.indexOf(',');
                const data = result.substring(commaIndex + 1);
                // Preserve original MIME type from file
                setFileData({ data, mimeType: file.type, filename: file.name });
                setFileUploadError(null); // Clear any previous errors

                // Track file upload
                if (currentSessionId) {
                    analyticsRef.current.trackFileAttached({
                        fileType: file.type,
                        fileSizeBytes: file.size,
                        sessionId: currentSessionId,
                    });
                }
            } catch {
                showUserError('Failed to process audio file. Please try again.');
                setFileData(null);
            }
        };
        reader.onerror = () => {
            showUserError('Failed to read audio file. Please try again.');
            setFileData(null);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (e.dataTransfer.types.includes('Files')) {
            setIsDragging(true);
        }
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;

        if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
            setIsDragging(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = e.dataTransfer.files;
        if (!files || files.length === 0) return;

        // Process all dropped image files
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (file.type.startsWith('image/')) {
                handlePasteImageFile(file);
            }

            if (file.type === 'application/pdf') {
                handleFile(file);
            }
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
                    <ChatInputContainer>
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
                        {(imageData || fileData) && (
                            <div className="px-4 pt-4">
                                <div className="flex items-center gap-2 flex-wrap">
                                    {imageData && (
                                        <div className="relative w-fit border border-border rounded-lg p-1 bg-muted/50 group">
                                            <img
                                                src={`data:${imageData.mimeType};base64,${imageData.image}`}
                                                alt="preview"
                                                className="h-12 w-auto rounded-md"
                                            />
                                            <Button
                                                variant="destructive"
                                                size="icon"
                                                onClick={removeImage}
                                                className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground opacity-100 group-hover:opacity-100 transition-opacity duration-150 shadow-md"
                                                aria-label="Remove image"
                                            >
                                                <X className="h-2 w-2" />
                                            </Button>
                                        </div>
                                    )}
                                    {fileData && (
                                        <div className="relative w-fit border border-border rounded-lg p-2 bg-muted/50 flex items-center gap-2 group">
                                            {fileData.mimeType.startsWith('audio') ? (
                                                <>
                                                    <FileAudio className="h-4 w-4" />
                                                    <audio
                                                        controls
                                                        src={`data:${fileData.mimeType};base64,${fileData.data}`}
                                                        className="h-8"
                                                    />
                                                </>
                                            ) : (
                                                <>
                                                    <File className="h-4 w-4" />
                                                    <span className="text-xs font-medium max-w-[160px] truncate">
                                                        {fileData.filename || 'attachment'}
                                                    </span>
                                                </>
                                            )}
                                            <Button
                                                variant="destructive"
                                                size="icon"
                                                onClick={() => setFileData(null)}
                                                className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground opacity-100 group-hover:opacity-100 transition-opacity duration-150 shadow-md"
                                                aria-label="Remove attachment"
                                            >
                                                <X className="h-2 w-2" />
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Editor area: scrollable, independent from footer */}
                        <div
                            className="flex-auto overflow-y-auto relative"
                            onDrop={handleDrop}
                            onDragOver={handleDragOver}
                            onDragEnter={handleDragEnter}
                            onDragLeave={handleDragLeave}
                        >
                            {isDragging && (
                                <div className="absolute inset-0 bg-accent/10 border-2 border-accent/40 border-dashed rounded-lg z-10 flex items-center justify-center pointer-events-none">
                                    <div className="bg-card px-4 py-2 rounded-lg shadow-lg border border-border">
                                        <p className="text-card-foreground font-medium flex items-center gap-2">
                                            <Upload className="w-5 h-5" />
                                            Drop images or PDFs here
                                        </p>
                                    </div>
                                </div>
                            )}
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
                                            onSelect={(r) => applyMentionSelection(mentionIndex, r)}
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
                                                : (!text.trim() && !imageData && !fileData) ||
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
                </form>

                {/* Previews moved inside bubble above editor */}

                {/* Hidden inputs */}
                <input
                    ref={fileInputRef}
                    type="file"
                    id="image-upload"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageChange}
                />
                <input
                    ref={pdfInputRef}
                    type="file"
                    id="pdf-upload"
                    accept="application/pdf"
                    className="hidden"
                    onChange={handlePdfChange}
                />
                <input
                    ref={audioInputRef}
                    type="file"
                    id="audio-upload"
                    accept="audio/*"
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
