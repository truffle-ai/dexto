'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '@/lib/api-client';
import ReactDOM from 'react-dom';
import TextareaAutosize from 'react-textarea-autosize';
import { Button } from './ui/button';
import {
    ChatInputContainer,
    ButtonFooter,
    StreamToggle,
    AttachButton,
    RecordButton,
} from './ChatInput';
import ModelPickerModal from './ModelPicker';
import { Badge } from './ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
    Paperclip,
    SendHorizontal,
    X,
    Loader2,
    Bot,
    ChevronDown,
    AlertCircle,
    Zap,
    Mic,
    Square,
    FileAudio,
    File,
    Search,
    Brain,
} from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';
import { useChatContext } from './hooks/ChatContext';
import { Switch } from './ui/switch';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './ui/tooltip';
import { useFontsReady } from './hooks/useFontsReady';
import { cn, filterAndSortResources } from '../lib/utils';
import ResourceAutocomplete from './ResourceAutocomplete';
import type { ResourceMetadata as UIResourceMetadata } from '@dexto/core';
import { useResources } from './hooks/useResources';
import SlashCommandAutocomplete from './SlashCommandAutocomplete';
import CreatePromptModal from './CreatePromptModal';
import CreateMemoryModal from './CreateMemoryModal';
import { parseSlashInput, splitKeyValueAndPositional } from '../lib/parseSlash';
import { useAnalytics } from '@/lib/analytics/index.js';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';

interface ModelOption {
    name: string;
    provider: string;
    model: string;
}

interface InputAreaProps {
    onSend: (
        content: string,
        imageData?: { base64: string; mimeType: string },
        fileData?: { base64: string; mimeType: string; filename?: string }
    ) => void;
    isSending?: boolean;
    variant?: 'welcome' | 'chat';
}

export default function InputArea({ onSend, isSending, variant = 'chat' }: InputAreaProps) {
    const queryClient = useQueryClient();
    const [text, setText] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [imageData, setImageData] = useState<{ base64: string; mimeType: string } | null>(null);
    const [fileData, setFileData] = useState<{
        base64: string;
        mimeType: string;
        filename?: string;
    } | null>(null);
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

    // Get current session context to ensure model switch applies to the correct session
    const { currentSessionId, isStreaming, setStreaming, cancel, processing, currentLLM } =
        useChatContext();

    // Analytics tracking
    const analytics = useAnalytics();
    const analyticsRef = useRef(analytics);

    // Keep analytics ref up to date to avoid stale closure issues
    useEffect(() => {
        analyticsRef.current = analytics;
    }, [analytics]);

    // LLM selector state
    const [isLoadingModel, setIsLoadingModel] = useState(false);
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

    // TODO: Populate using LLM_REGISTRY by exposing an API endpoint
    const coreModels = [
        { name: 'Claude 4.5 Sonnet', provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
        { name: 'GPT-5', provider: 'openai', model: 'gpt-5' },
        { name: 'GPT-5 Mini', provider: 'openai', model: 'gpt-5-mini' },
        { name: 'Gemini 2.5 Pro', provider: 'google', model: 'gemini-2.5-pro' },
    ];

    // File size limit (64MB)
    const MAX_FILE_SIZE = 64 * 1024 * 1024; // 64MB in bytes

    // Slash command state
    const [showSlashCommands, setShowSlashCommands] = useState(false);
    const [showCreatePromptModal, setShowCreatePromptModal] = useState(false);
    const [slashRefreshKey, setSlashRefreshKey] = useState(0);

    // Memory state
    const [showCreateMemoryModal, setShowCreateMemoryModal] = useState(false);

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
            // Manual cache invalidation needed for custom prompt creation (not triggered by WebSocket events)
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
    useEffect(() => {
        const loadSupportedFileTypes = async () => {
            try {
                const data = await apiFetch<{
                    models: Array<{
                        provider: string;
                        name: string;
                        supportedFileTypes?: string[];
                    }>;
                }>('/api/llm/catalog?mode=flat');
                const models = data.models || [];
                const provider = currentLLM?.provider;
                const model = currentLLM?.model;
                if (!provider || !model) return;
                const match = models.find((m) => m.provider === provider && m.name === model);
                setSupportedFileTypes(match?.supportedFileTypes || []);
            } catch (e) {
                // ignore – default to []
                setSupportedFileTypes([]);
            }
        };
        loadSupportedFileTypes();
    }, [currentLLM?.provider, currentLLM?.model]);

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
                    // Build query parameters
                    const params = new URLSearchParams();
                    // Build structured args from tokens: key=value map + positional array
                    if (parsed.argsArray && parsed.argsArray.length > 0) {
                        const { keyValues, positional } = splitKeyValueAndPositional(
                            parsed.argsArray
                        );
                        const argsPayload: Record<string, unknown> = { ...keyValues };
                        if (positional.length > 0) argsPayload._positional = positional;
                        if (Object.keys(argsPayload).length > 0) {
                            try {
                                params.set('args', JSON.stringify(argsPayload));
                            } catch {
                                // ignore JSON errors and fall back to context-only
                            }
                        }
                    }
                    // Keep context for natural language compatibility
                    if (originalArgsText) params.set('context', originalArgsText);

                    const queryString = params.toString() ? `?${params.toString()}` : '';

                    // Add timeout to prevent hanging on slow responses
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

                    try {
                        const data = await apiFetch<{ text?: string }>(
                            `/api/prompts/${encodeURIComponent(name)}/resolve${queryString}`,
                            { signal: controller.signal }
                        );
                        clearTimeout(timeoutId);
                        const txt = typeof data?.text === 'string' ? data.text : '';
                        if (txt.trim()) {
                            trimmed = txt;
                        }
                    } finally {
                        clearTimeout(timeoutId);
                    }
                } catch {
                    // keep original
                }
            }
        }

        onSend(trimmed, imageData ?? undefined, fileData ?? undefined);
        setText('');
        setImageData(null);
        setFileData(null);
        // Ensure guidance window closes after submit
        setShowSlashCommands(false);
        // Height handled by CSS; no imperative adjustments.
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
        const pasted = e.clipboardData.getData('text/plain');
        if (!pasted) return;
        if (pasted.length <= LARGE_PASTE_THRESHOLD) return;
        e.preventDefault();
        const attach = window.confirm(
            'Large text detected. Attach as a file instead of inflating the input?\n(OK = attach as file, Cancel = paste truncated preview)'
        );
        if (attach) {
            setFileData({
                base64: toBase64(pasted),
                mimeType: 'text/plain',
                filename: 'pasted.txt',
            });
        } else {
            const preview = pasted.slice(0, LARGE_PASTE_THRESHOLD);
            setText((prev) => prev + preview);
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
                const base64 = result.substring(commaIndex + 1);
                setFileData({ base64, mimeType: 'application/pdf', filename: file.name });
                setFileUploadError(null); // Clear any previous errors

                // Track file upload
                if (currentSessionId) {
                    analyticsRef.current.trackFileUploaded({
                        fileType: 'application/pdf',
                        fileSizeBytes: file.size,
                        sessionId: currentSessionId,
                    });
                }
            } catch (error) {
                showUserError('Failed to process PDF file. Please try again.');
                setFileData(null);
            }
        };
        reader.onerror = (error) => {
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
                        const base64 = result.substring(commaIndex + 1);
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
                            base64,
                            mimeType: mimeType,
                            filename: `recording.${ext}`,
                        });

                        // Track audio recording upload
                        if (currentSessionId) {
                            analyticsRef.current.trackFileUploaded({
                                fileType: mimeType,
                                fileSizeBytes: blob.size,
                                sessionId: currentSessionId,
                            });
                        }
                    } catch (error) {
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
        } catch (error) {
            showUserError('Failed to start audio recording. Please check microphone permissions.');
        }
    };

    const stopRecording = () => {
        mediaRecorderRef.current?.stop();
        setIsRecording(false);
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
                const base64 = result.substring(commaIndex + 1);

                const mimeMatch = meta.match(/data:(.*);base64/);
                const mimeType = mimeMatch ? mimeMatch[1] : file.type;

                if (!mimeType) throw new Error('Could not determine MIME type');

                setImageData({ base64, mimeType });
                setFileUploadError(null); // Clear any previous errors

                // Track image upload
                if (currentSessionId) {
                    analyticsRef.current.trackImageUploaded({
                        imageType: mimeType,
                        imageSizeBytes: file.size,
                        sessionId: currentSessionId,
                    });
                }
            } catch (error) {
                showUserError('Failed to process image file. Please try again.');
                setImageData(null);
            }
        };
        reader.onerror = (error) => {
            showUserError('Failed to read image file. Please try again.');
            setImageData(null);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
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

    const showClearButton = text.length > 0 || !!imageData || !!fileData;

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
                const base64 = result.substring(commaIndex + 1);
                // Preserve original MIME type from file
                setFileData({ base64, mimeType: file.type, filename: file.name });
                setFileUploadError(null); // Clear any previous errors

                // Track file upload
                if (currentSessionId) {
                    analyticsRef.current.trackFileUploaded({
                        fileType: file.type,
                        fileSizeBytes: file.size,
                        sessionId: currentSessionId,
                    });
                }
            } catch (error) {
                showUserError('Failed to process audio file. Please try again.');
                setFileData(null);
            }
        };
        reader.onerror = (error) => {
            showUserError('Failed to read audio file. Please try again.');
            setFileData(null);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
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
                        {/* Attachments strip (inside bubble, above editor) */}
                        {(imageData || fileData) && (
                            <div className="px-4 pt-4">
                                <div className="flex items-center gap-2 flex-wrap">
                                    {imageData && (
                                        <div className="relative w-fit border border-border rounded-lg p-1 bg-muted/50 group">
                                            <img
                                                src={`data:${imageData.mimeType};base64,${imageData.base64}`}
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
                                                        src={`data:${fileData.mimeType};base64,${fileData.base64}`}
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
                                    />

                                    <RecordButton
                                        isRecording={isRecording}
                                        onToggleRecording={
                                            isRecording ? stopRecording : startRecording
                                        }
                                        disabled={!supportedFileTypes.includes('audio')}
                                    />
                                </div>
                            }
                            rightButtons={
                                <div className="flex items-center gap-2">
                                    <div className="hidden md:block">
                                        <StreamToggle
                                            isStreaming={isStreaming}
                                            onStreamingChange={setStreaming}
                                        />
                                    </div>

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
