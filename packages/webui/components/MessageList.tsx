import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
    Message,
    isToolResultError,
    isToolResultContent,
    isUserMessage,
    isAssistantMessage,
    isToolMessage,
    ErrorMessage,
    ToolResult,
} from './hooks/useChat';
import { isTextPart, isImagePart, isAudioPart, isFilePart, isUIResourcePart } from '../types';
import type { TextPart, AudioPart, UIResourcePart } from '../types';
import { getFileMediaKind } from '@dexto/core';
import ErrorBanner from './ErrorBanner';
import {
    ChevronUp,
    Loader2,
    AlertTriangle,
    Info,
    File,
    FileAudio,
    ChevronDown,
    Brain,
    X,
    ZoomIn,
    FileVideo,
} from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { MarkdownText } from './ui/markdown-text';
import { CopyButton } from './ui/copy-button';
import { SpeakButton } from './ui/speak-button';
import { UIResourceRendererWrapper } from './ui/ui-resource-renderer';
import {
    useResourceContent,
    type ResourceState,
    type NormalizedResourceItem,
} from './hooks/useResourceContent';
import { useResources } from './hooks/useResources';
import type { ResourceMetadata } from '@dexto/core';
import { parseResourceReferences, resolveResourceReferences } from '@dexto/core';
import { type ApprovalEvent } from './ToolConfirmationHandler';
import { ToolCallTimeline } from './ToolCallTimeline';
import { TodoPanel } from './TodoPanel';

interface MessageListProps {
    messages: Message[];
    processing?: boolean;
    /** Name of tool currently executing (for status indicator) */
    currentToolName?: string | null;
    activeError?: ErrorMessage | null;
    onDismissError?: () => void;
    pendingApproval?: ApprovalEvent | null;
    onApprovalApprove?: (formData?: Record<string, any>, rememberChoice?: boolean) => void;
    onApprovalDeny?: () => void;
    /**
     * Optional ref to the outer content container so parents can observe size
     * changes (for robust autoscroll). When provided, it is attached to the
     * top-level wrapping div around the list content.
     */
    outerRef?: React.Ref<HTMLDivElement>;
    /** Session ID for todo panel */
    sessionId?: string | null;
}

// Helper to format timestamp from createdAt
const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// Helper to validate data URIs to prevent XSS
function isValidDataUri(src: string, expectedType?: 'image' | 'video' | 'audio'): boolean {
    const typePattern = expectedType ? `${expectedType}/` : '[a-z0-9.+-]+/';
    const dataUriRegex = new RegExp(
        `^data:${typePattern}[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$`,
        'i'
    );
    return dataUriRegex.test(src);
}

function isLikelyBase64(value: string): boolean {
    if (!value || value.length < 16) return false;
    if (value.startsWith('http://') || value.startsWith('https://')) return false;
    if (value.startsWith('data:') || value.startsWith('@blob:')) return false;
    return /^[A-Za-z0-9+/=\r\n]+$/.test(value);
}

// Helper to validate safe HTTP/HTTPS URLs for media
function isSafeHttpUrl(src: string): boolean {
    try {
        const url = new URL(src);
        const hostname = url.hostname.toLowerCase();

        // Check protocol
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
            return false;
        }

        // Block localhost and common local names
        if (hostname === 'localhost' || hostname === '::1') {
            return false;
        }

        // Check for IPv4 addresses
        const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
        const ipv4Match = hostname.match(ipv4Regex);
        if (ipv4Match) {
            const [, a, b, c, d] = ipv4Match.map(Number);

            // Validate IP range (0-255)
            if (a > 255 || b > 255 || c > 255 || d > 255) {
                return false;
            }

            // Block loopback (127.0.0.0/8)
            if (a === 127) {
                return false;
            }

            // Block private networks (RFC 1918)
            // 10.0.0.0/8
            if (a === 10) {
                return false;
            }

            // 172.16.0.0/12
            if (a === 172 && b >= 16 && b <= 31) {
                return false;
            }

            // 192.168.0.0/16
            if (a === 192 && b === 168) {
                return false;
            }

            // Block link-local (169.254.0.0/16)
            if (a === 169 && b === 254) {
                return false;
            }

            // Block 0.0.0.0
            if (a === 0 && b === 0 && c === 0 && d === 0) {
                return false;
            }
        }

        // Check for IPv6 addresses
        if (hostname.includes(':')) {
            // Block IPv6 loopback
            if (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') {
                return false;
            }

            // Block IPv6 unique-local (fc00::/7)
            if (hostname.startsWith('fc') || hostname.startsWith('fd')) {
                return false;
            }

            // Block IPv6 link-local (fe80::/10)
            if (
                hostname.startsWith('fe8') ||
                hostname.startsWith('fe9') ||
                hostname.startsWith('fea') ||
                hostname.startsWith('feb')
            ) {
                return false;
            }
        }

        return true;
    } catch {
        return false;
    }
}

// Helper to check if a URL is safe for media rendering
function isSafeMediaUrl(src: string, expectedType?: 'image' | 'video' | 'audio'): boolean {
    if (src.startsWith('blob:') || isSafeHttpUrl(src)) return true;
    if (src.startsWith('data:')) {
        return expectedType ? isValidDataUri(src, expectedType) : isValidDataUri(src);
    }
    return false;
}

// Helper to check if a URL is safe for audio rendering
function isSafeAudioUrl(src: string): boolean {
    return isSafeMediaUrl(src, 'audio');
}

function resolveMediaSrc(
    part: any,
    resourceStates?: Record<string, ResourceState | undefined>
): string {
    if (!part) return '';

    const mimeType: string | undefined = part?.mimeType;
    const dataCandidate: unknown =
        typeof part === 'string'
            ? part
            : (part?.data ?? part?.image ?? part?.audio ?? part?.video ?? part?.uri ?? part?.url);

    if (typeof dataCandidate === 'string') {
        if (dataCandidate.startsWith('@blob:')) {
            const uri = dataCandidate.substring(1);
            if (resourceStates && uri) {
                const state = resourceStates[uri];
                if (state && state.status === 'loaded' && state.data) {
                    const preferKinds: Array<NormalizedResourceItem['kind']> = [];
                    if (part?.type === 'image') preferKinds.push('image');
                    if (part?.type === 'file') {
                        const mediaKind = getFileMediaKind(part.mimeType);
                        if (mediaKind === 'audio') preferKinds.push('audio');
                        else if (mediaKind === 'video') preferKinds.push('video');
                    }
                    if (part?.mimeType?.startsWith('image/')) preferKinds.push('image');
                    if (part?.mimeType?.startsWith('audio/')) preferKinds.push('audio');
                    if (part?.mimeType?.startsWith('video/')) preferKinds.push('video');

                    const preferredItem =
                        state.data.items.find((item) => preferKinds.includes(item.kind as any)) ??
                        state.data.items.find((item) => item.kind === 'image') ??
                        state.data.items.find((item) => item.kind === 'video') ??
                        state.data.items.find((item) => item.kind === 'audio') ??
                        state.data.items[0];

                    if (
                        preferredItem &&
                        'src' in preferredItem &&
                        typeof preferredItem.src === 'string'
                    ) {
                        return preferredItem.src;
                    }
                }
            }
            return '';
        }

        if (dataCandidate.startsWith('data:')) {
            return dataCandidate;
        }

        if (mimeType && isLikelyBase64(dataCandidate)) {
            return `data:${mimeType};base64,${dataCandidate}`;
        }

        if (isSafeMediaUrl(dataCandidate)) {
            return dataCandidate;
        }
    }

    const urlSrc = part?.url ?? part?.image ?? part?.audio ?? part?.video ?? part?.uri;
    return typeof urlSrc === 'string' ? urlSrc : '';
}

interface VideoInfo {
    src: string;
    filename?: string;
    mimeType?: string;
}

function getVideoInfo(
    part: unknown,
    resourceStates?: Record<string, ResourceState | undefined>
): VideoInfo | null {
    if (!part || typeof part !== 'object') return null;

    const anyPart = part as Record<string, any>;
    const mimeType = anyPart.mimeType || anyPart.mediaType;
    const filename = anyPart.filename || anyPart.name;

    const mediaKind = anyPart.type === 'file' ? getFileMediaKind(anyPart.mimeType) : null;
    const isVideo =
        mimeType?.startsWith('video/') ||
        mediaKind === 'video' ||
        anyPart.type === 'video' ||
        filename?.match(/\.(mp4|webm|mov|m4v|avi|mkv)$/i);

    if (!isVideo) return null;

    const src = resolveMediaSrc(anyPart, resourceStates);
    return src && isSafeMediaUrl(src, 'video') ? { src, filename, mimeType } : null;
}

function ThinkingIndicator({ toolName }: { toolName?: string | null }) {
    return (
        <div
            className="flex items-center gap-2 py-1 pl-1 text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
        >
            {/* Animated spinner */}
            <div className="relative h-3.5 w-3.5">
                <div className="absolute inset-0 rounded-full border-[1.5px] border-muted-foreground/20" />
                <div className="absolute inset-0 rounded-full border-[1.5px] border-transparent border-t-muted-foreground/60 animate-spin" />
            </div>

            {/* Label */}
            {toolName ? (
                <span>
                    <span className="text-muted-foreground/70">Running</span>{' '}
                    <span className="font-mono text-blue-600 dark:text-blue-400">
                        {toolName
                            .replace(/^(internal--|custom--|mcp--[^-]+--|mcp__[^_]+__)/, '')
                            .replace(/^(internal__|custom__)/, '')}
                    </span>
                </span>
            ) : (
                <span className="text-muted-foreground/70">Thinking</span>
            )}
        </div>
    );
}

export default function MessageList({
    messages,
    processing = false,
    currentToolName,
    activeError,
    onDismissError,
    outerRef,
    pendingApproval: _pendingApproval,
    onApprovalApprove,
    onApprovalDeny,
    sessionId,
}: MessageListProps) {
    const endRef = useRef<HTMLDivElement>(null);
    const [manuallyExpanded, setManuallyExpanded] = useState<Record<string, boolean>>({});
    const [reasoningExpanded, setReasoningExpanded] = useState<Record<string, boolean>>({});
    const [imageModal, setImageModal] = useState<{ isOpen: boolean; src: string; alt: string }>({
        isOpen: false,
        src: '',
        alt: '',
    });
    const { resources: availableResources } = useResources();
    const resourceSet = useMemo<Record<string, ResourceMetadata>>(() => {
        const map: Record<string, ResourceMetadata> = {};
        for (const resource of availableResources) {
            map[resource.uri] = {
                ...resource,
            };
        }
        return map;
    }, [availableResources]);

    const toolResourceUris = useMemo(() => {
        const uris = new Set<string>();

        const addUri = (value: unknown) => {
            if (typeof value !== 'string') return;
            const trimmed = value.startsWith('@') ? value.substring(1) : value;
            if (trimmed.startsWith('blob:')) {
                uris.add(trimmed);
            }
        };

        const collectFromPart = (part: unknown) => {
            if (!part) return;
            if (typeof part === 'string') {
                addUri(part);
                return;
            }
            if (typeof part !== 'object') return;
            const anyPart = part as Record<string, unknown>;
            if (typeof anyPart.image === 'string') {
                addUri(anyPart.image as string);
            }
            if (typeof anyPart.data === 'string') {
                addUri(anyPart.data as string);
            }
            if (typeof anyPart.url === 'string') {
                addUri(anyPart.url as string);
            }
            if (typeof anyPart.audio === 'string') {
                addUri(anyPart.audio as string);
            }
            if (typeof anyPart.video === 'string') {
                addUri(anyPart.video as string);
            }
        };

        for (const msg of messages) {
            if (!isToolMessage(msg)) continue;
            const toolResult = msg.toolResult;
            if (!toolResult) continue;
            if (isToolResultContent(toolResult)) {
                toolResult.resources?.forEach((res) => {
                    if (res?.uri?.startsWith('blob:')) {
                        uris.add(res.uri);
                    }
                });
                toolResult.content?.forEach((part) => collectFromPart(part));
            } else if ((toolResult as any)?.content && Array.isArray((toolResult as any).content)) {
                (toolResult as any).content.forEach((part: unknown) => collectFromPart(part));
            }
        }

        return Array.from(uris);
    }, [messages]);

    const toolResourceStates = useResourceContent(toolResourceUris);

    // Add CSS for audio controls overflow handling
    useEffect(() => {
        const style = document.createElement('style');
        style.textContent = `
      .audio-controls-container audio {
        max-width: 100% !important;
        width: 100% !important;
        height: auto !important;
        min-height: 32px;
      }
      .audio-controls-container audio::-webkit-media-controls-panel {
        max-width: 100% !important;
      }
      .audio-controls-container audio::-webkit-media-controls-timeline {
        max-width: 100% !important;
      }
    `;
        document.head.appendChild(style);
        return () => {
            document.head.removeChild(style);
        };
    }, []);

    const openImageModal = (src: string, alt: string) => {
        setImageModal({ isOpen: true, src, alt });
    };

    const closeImageModal = () => {
        setImageModal({ isOpen: false, src: '', alt: '' });
    };

    // NOTE: Autoscroll is now delegated to the parent (ChatApp) which
    // observes size changes and maintains isAtBottom state.

    if (!messages || messages.length === 0) {
        return null;
    }

    // Helper function to extract plain text from message for copy functionality
    const getPlainTextFromMessage = (msg: Message): string => {
        if (typeof msg.content === 'string') return msg.content;
        if (Array.isArray(msg.content)) {
            return msg.content
                .map((p) => (isTextPart(p) ? p.text : ''))
                .filter(Boolean)
                .join('\n');
        }
        if (msg.content && typeof msg.content === 'object')
            return JSON.stringify(msg.content, null, 2);
        return '';
    };

    // Helper: Find the start index of the run ending at endIdx
    const getRunStartIdx = (endIdx: number): number => {
        for (let i = endIdx - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg && isUserMessage(msg)) {
                return i + 1;
            }
        }
        return 0;
    };

    // Helper: Get all assistant text from a run ending at idx (for copy/speak aggregation)
    const getRunAssistantText = (endIdx: number): string => {
        const texts: string[] = [];
        const startIdx = getRunStartIdx(endIdx);
        // Collect all assistant message text from startIdx to endIdx
        for (let i = startIdx; i <= endIdx; i++) {
            const msg = messages[i];
            if (msg && isAssistantMessage(msg)) {
                const text = getPlainTextFromMessage(msg);
                if (text.trim()) {
                    texts.push(text);
                }
            }
        }
        return texts.join('\n\n');
    };

    // Helper: Get cumulative token usage for a run ending at idx
    const getRunTokenUsage = (
        endIdx: number
    ): {
        inputTokens: number;
        outputTokens: number;
        reasoningTokens: number;
        totalTokens: number;
    } => {
        const startIdx = getRunStartIdx(endIdx);
        let inputTokens = 0;
        let outputTokens = 0;
        let reasoningTokens = 0;
        let totalTokens = 0;

        for (let i = startIdx; i <= endIdx; i++) {
            const msg = messages[i];
            if (msg && isAssistantMessage(msg) && msg.tokenUsage) {
                inputTokens += msg.tokenUsage.inputTokens ?? 0;
                outputTokens += msg.tokenUsage.outputTokens ?? 0;
                reasoningTokens += msg.tokenUsage.reasoningTokens ?? 0;
                totalTokens += msg.tokenUsage.totalTokens ?? 0;
            }
        }

        return { inputTokens, outputTokens, reasoningTokens, totalTokens };
    };

    // Note: getToolResultCopyText was used for old tool box rendering, now handled by ToolCallTimeline
    const _getToolResultCopyText = (result: ToolResult | undefined): string => {
        if (!result) return '';
        if (isToolResultError(result)) {
            return typeof result.error === 'object'
                ? JSON.stringify(result.error, null, 2)
                : String(result.error);
        }
        if (isToolResultContent(result)) {
            return result.content
                .map((part) =>
                    isTextPart(part) ? part.text : typeof part === 'object' ? '' : String(part)
                )
                .filter(Boolean)
                .join('\n');
        }
        return typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
    };

    // Helper: Check if this assistant message is the last one before a user message (end of a "run")
    const isLastAssistantInRun = (idx: number): boolean => {
        const msg = messages[idx];
        if (!msg || !isAssistantMessage(msg)) return false;

        // Look ahead to find the next non-tool message
        for (let i = idx + 1; i < messages.length; i++) {
            const nextMsg = messages[i];
            if (!nextMsg) continue;
            // Skip tool messages - they're part of the same run
            if (isToolMessage(nextMsg)) continue;
            // If next non-tool message is a user message, this is the last assistant in the run
            if (isUserMessage(nextMsg)) return true;
            // If next non-tool message is another assistant message, this is not the last
            if (isAssistantMessage(nextMsg)) return false;
        }
        // If we reach here, no user message follows - show metadata only if not processing
        return !processing;
    };

    return (
        <div
            id="message-list-container"
            ref={outerRef}
            className="flex flex-col space-y-3 px-3 sm:px-4 py-2 min-w-0 w-full"
        >
            {messages.map((msg, idx) => {
                const msgKey = msg.id ?? `msg-${idx}`;
                const isUser = isUserMessage(msg);
                const isAi = isAssistantMessage(msg);
                const isTool = isToolMessage(msg);

                const isLastMessage = idx === messages.length - 1;
                const isToolCall = isTool && !!(msg.toolName && msg.toolArgs);
                const isToolResult = isTool && !!(msg.toolName && msg.toolResult);
                const isToolRelated = isToolCall || isToolResult;

                // Only show metadata (tokens, model) on the last assistant message of a run
                const showAssistantMetadata = isAi && isLastAssistantInRun(idx);

                // Note: isExpanded was used for old tool box rendering, now handled by ToolCallTimeline
                const _isExpanded = (isToolRelated && isLastMessage) || !!manuallyExpanded[msgKey];

                // Extract media parts from tool results for separate rendering
                const toolResultImages: Array<{ src: string; alt: string; index: number }> = [];
                const toolResultAudios: Array<{ src: string; filename?: string; index: number }> =
                    [];
                const toolResultVideos: Array<{
                    src: string;
                    filename?: string;
                    mimeType?: string;
                    index: number;
                }> = [];
                const toolResultUIResources: Array<{ resource: UIResourcePart; index: number }> =
                    [];
                if (isToolMessage(msg) && msg.toolResult && isToolResultContent(msg.toolResult)) {
                    msg.toolResult.content.forEach((part: unknown, index: number) => {
                        // Handle UI resource parts (MCP-UI interactive content)
                        if (isUIResourcePart(part)) {
                            toolResultUIResources.push({
                                resource: part,
                                index,
                            });
                        } else if (isImagePart(part)) {
                            const src = resolveMediaSrc(part, toolResourceStates);

                            if (src && isSafeMediaUrl(src, 'image')) {
                                toolResultImages.push({
                                    src,
                                    alt: `Tool result image ${index + 1}`,
                                    index,
                                });
                            }
                        } else if (isAudioPart(part)) {
                            const audio = part as AudioPart;
                            const src = resolveMediaSrc(audio, toolResourceStates);

                            if (src && isSafeMediaUrl(src, 'audio')) {
                                toolResultAudios.push({
                                    src,
                                    filename: audio.filename,
                                    index,
                                });
                            }
                        } else if (
                            isFilePart(part) &&
                            (getFileMediaKind(part.mimeType) === 'audio' ||
                                part.mimeType?.startsWith('audio/'))
                        ) {
                            const src = resolveMediaSrc(part, toolResourceStates);
                            if (src && isSafeMediaUrl(src, 'audio')) {
                                toolResultAudios.push({
                                    src,
                                    filename: part.filename,
                                    index,
                                });
                            }
                        } else {
                            const videoInfo = getVideoInfo(part, toolResourceStates);
                            if (videoInfo) {
                                toolResultVideos.push({
                                    ...videoInfo,
                                    index,
                                });
                            }
                        }
                    });
                }

                // Note: toggleManualExpansion was used for old tool box rendering, now handled by ToolCallTimeline
                const _toggleManualExpansion = () => {
                    if (isToolRelated) {
                        setManuallyExpanded((prev) => ({
                            ...prev,
                            [msgKey]: !prev[msgKey],
                        }));
                    }
                };

                const messageContainerClass = 'w-full' + (isTool ? ' pl-2' : ''); // Tool messages get slight indent for timeline

                // Bubble styling: users get subtle bubble; AI and tools blend with background
                const bubbleSpecificClass = cn(
                    isTool
                        ? 'w-full max-w-[90%]'
                        : isUser
                          ? 'px-4 py-3 rounded-2xl w-fit max-w-[75%] bg-primary/15 text-foreground rounded-br-sm text-base break-words overflow-wrap-anywhere overflow-hidden'
                          : isAi
                            ? 'px-4 py-3 w-full max-w-[min(90%,calc(100vw-6rem))] text-base break-normal hyphens-none'
                            : ''
                );

                const contentWrapperClass = 'flex flex-col gap-2';
                const timestampStr = formatTimestamp(msg.createdAt);

                const errorAnchoredHere = !!(activeError && activeError.anchorMessageId === msg.id);

                return (
                    <React.Fragment key={msgKey}>
                        <div
                            className="w-full"
                            data-role={msg.role}
                            id={msg.id ? `message-${msg.id}` : undefined}
                        >
                            <div className={messageContainerClass}>
                                <div
                                    className={cn(
                                        'flex flex-col group w-full min-w-0',
                                        isUser ? 'items-end' : 'items-start'
                                    )}
                                >
                                    <div className={cn(bubbleSpecificClass, 'min-w-0')}>
                                        <div className={cn(contentWrapperClass, 'min-w-0')}>
                                            {/* Reasoning panel (assistant only) - display at top */}
                                            {isAi &&
                                                typeof msg.reasoning === 'string' &&
                                                msg.reasoning.trim().length > 0 && (
                                                    <div className="mb-3 border border-orange-200/50 dark:border-orange-400/20 rounded-lg bg-gradient-to-br from-orange-50/30 to-amber-50/20 dark:from-orange-900/20 dark:to-amber-900/10">
                                                        <div className="px-3 py-2 border-b border-orange-200/30 dark:border-orange-400/20 bg-orange-100/50 dark:bg-orange-900/30 rounded-t-lg flex items-center justify-between">
                                                            <button
                                                                type="button"
                                                                className="flex items-center gap-2 text-xs font-medium text-orange-700 dark:text-orange-300 hover:text-orange-800 dark:hover:text-orange-200 transition-colors group"
                                                                onClick={() =>
                                                                    setReasoningExpanded(
                                                                        (prev) => ({
                                                                            ...prev,
                                                                            [msgKey]: !(
                                                                                prev[msgKey] ?? true
                                                                            ),
                                                                        })
                                                                    )
                                                                }
                                                            >
                                                                <Brain className="h-3.5 w-3.5" />
                                                                <span>AI Reasoning</span>
                                                                {(reasoningExpanded[msgKey] ??
                                                                true) ? (
                                                                    <ChevronUp className="h-3 w-3 group-hover:scale-110 transition-transform" />
                                                                ) : (
                                                                    <ChevronDown className="h-3 w-3 group-hover:scale-110 transition-transform" />
                                                                )}
                                                            </button>
                                                            <div className="flex items-center gap-1">
                                                                <CopyButton
                                                                    value={msg.reasoning}
                                                                    tooltip="Copy reasoning"
                                                                    copiedTooltip="Copied!"
                                                                    className="opacity-70 hover:opacity-100 transition-opacity"
                                                                />
                                                                <SpeakButton
                                                                    value={msg.reasoning}
                                                                    tooltip="Speak reasoning"
                                                                    stopTooltip="Stop"
                                                                    className="opacity-70 hover:opacity-100 transition-opacity"
                                                                />
                                                            </div>
                                                        </div>
                                                        {(reasoningExpanded[msgKey] ?? true) && (
                                                            <div className="px-3 py-2">
                                                                <pre className="whitespace-pre-wrap break-words text-xs text-orange-800/80 dark:text-orange-200/70 leading-relaxed font-mono">
                                                                    {msg.reasoning}
                                                                </pre>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                            {isToolMessage(msg) && msg.toolName ? (
                                                <ToolCallTimeline
                                                    toolName={msg.toolName}
                                                    toolArgs={msg.toolArgs}
                                                    toolResult={msg.toolResult}
                                                    displayData={msg.toolResultMeta?.display}
                                                    subAgentProgress={msg.subAgentProgress}
                                                    success={
                                                        // Rejected approvals are failures
                                                        msg.approvalStatus === 'rejected'
                                                            ? false
                                                            : // Explicit failure status
                                                              msg.toolResultSuccess === false
                                                              ? false
                                                              : // Check tool result for success
                                                                msg.toolResult
                                                                ? !isToolResultError(msg.toolResult)
                                                                : // Still processing (no result yet)
                                                                  undefined
                                                    }
                                                    requireApproval={msg.requireApproval}
                                                    approvalStatus={msg.approvalStatus}
                                                    onApprove={
                                                        msg.requireApproval &&
                                                        msg.approvalStatus === 'pending' &&
                                                        onApprovalApprove
                                                            ? (formData, rememberChoice) =>
                                                                  onApprovalApprove(
                                                                      formData,
                                                                      rememberChoice
                                                                  )
                                                            : undefined
                                                    }
                                                    onReject={
                                                        msg.requireApproval &&
                                                        msg.approvalStatus === 'pending' &&
                                                        onApprovalDeny
                                                            ? () => onApprovalDeny()
                                                            : undefined
                                                    }
                                                />
                                            ) : (
                                                <>
                                                    {typeof msg.content === 'string' &&
                                                        msg.content.trim() !== '' && (
                                                            <div className="relative">
                                                                <MessageContentWithResources
                                                                    key={`${msgKey}-text-content`}
                                                                    text={msg.content}
                                                                    isUser={isUser}
                                                                    onOpenImage={openImageModal}
                                                                    resourceSet={resourceSet}
                                                                />
                                                            </div>
                                                        )}

                                                    {msg.content &&
                                                        typeof msg.content === 'object' &&
                                                        !Array.isArray(msg.content) && (
                                                            <pre className="whitespace-pre-wrap break-words overflow-auto bg-background/50 p-2 rounded text-xs text-muted-foreground">
                                                                {JSON.stringify(
                                                                    msg.content,
                                                                    null,
                                                                    2
                                                                )}
                                                            </pre>
                                                        )}

                                                    {Array.isArray(msg.content) &&
                                                        (() => {
                                                            // Group content by type for smart rendering
                                                            const textParts: Array<{
                                                                part: TextPart;
                                                                idx: number;
                                                            }> = [];
                                                            const imageParts: Array<{
                                                                src: string;
                                                                idx: number;
                                                            }> = [];
                                                            const uiResourceParts: Array<{
                                                                part: UIResourcePart;
                                                                idx: number;
                                                            }> = [];
                                                            const otherParts: Array<{
                                                                part: any;
                                                                idx: number;
                                                            }> = [];

                                                            msg.content.forEach((part, idx) => {
                                                                if (part.type === 'text') {
                                                                    textParts.push({
                                                                        part: part as TextPart,
                                                                        idx,
                                                                    });
                                                                } else if (isUIResourcePart(part)) {
                                                                    uiResourceParts.push({
                                                                        part,
                                                                        idx,
                                                                    });
                                                                } else if (isImagePart(part)) {
                                                                    const src = resolveMediaSrc(
                                                                        part,
                                                                        toolResourceStates
                                                                    );
                                                                    if (
                                                                        src &&
                                                                        isSafeMediaUrl(src, 'image')
                                                                    ) {
                                                                        imageParts.push({
                                                                            src,
                                                                            idx,
                                                                        });
                                                                    }
                                                                } else {
                                                                    otherParts.push({ part, idx });
                                                                }
                                                            });

                                                            return (
                                                                <>
                                                                    {/* Render text parts */}
                                                                    {textParts.map(
                                                                        ({ part, idx }) => (
                                                                            <MessageContentWithResources
                                                                                key={`${msgKey}-text-${idx}`}
                                                                                text={part.text}
                                                                                isUser={isUser}
                                                                                onOpenImage={
                                                                                    openImageModal
                                                                                }
                                                                                resourceSet={
                                                                                    resourceSet
                                                                                }
                                                                            />
                                                                        )
                                                                    )}

                                                                    {/* Render images in a grid */}
                                                                    {imageParts.length > 0 && (
                                                                        <div
                                                                            className={cn(
                                                                                'grid gap-2 mt-2',
                                                                                imageParts.length ===
                                                                                    1
                                                                                    ? 'grid-cols-1'
                                                                                    : imageParts.length ===
                                                                                        2
                                                                                      ? 'grid-cols-2'
                                                                                      : 'grid-cols-3'
                                                                            )}
                                                                        >
                                                                            {imageParts.map(
                                                                                ({ src, idx }) => (
                                                                                    <img
                                                                                        key={`${msgKey}-img-${idx}`}
                                                                                        src={src}
                                                                                        alt={`Attachment ${idx + 1}`}
                                                                                        className="rounded-lg border border-border object-cover cursor-pointer w-full h-32 sm:h-40"
                                                                                        onClick={() =>
                                                                                            openImageModal(
                                                                                                src,
                                                                                                `Attachment ${idx + 1}`
                                                                                            )
                                                                                        }
                                                                                    />
                                                                                )
                                                                            )}
                                                                        </div>
                                                                    )}

                                                                    {/* Render UI resources */}
                                                                    {uiResourceParts.map(
                                                                        ({ part, idx }) => (
                                                                            <div
                                                                                key={`${msgKey}-ui-${idx}`}
                                                                                className="my-2"
                                                                            >
                                                                                <UIResourceRendererWrapper
                                                                                    resource={part}
                                                                                    onAction={(
                                                                                        action
                                                                                    ) => {
                                                                                        console.log(
                                                                                            `MCP-UI Action: ${action}`
                                                                                        );
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                        )
                                                                    )}

                                                                    {/* Render other parts (videos, audio, files) */}
                                                                    {otherParts.map(
                                                                        ({ part, idx }) => {
                                                                            const partKey = `${msgKey}-other-${idx}`;

                                                                            const videoInfo =
                                                                                getVideoInfo(part);
                                                                            if (videoInfo) {
                                                                                const {
                                                                                    src,
                                                                                    filename,
                                                                                    mimeType,
                                                                                } = videoInfo;
                                                                                return (
                                                                                    <div
                                                                                        key={
                                                                                            partKey
                                                                                        }
                                                                                        className="my-2 flex flex-col gap-2 p-3 rounded-lg border border-border bg-muted/50"
                                                                                    >
                                                                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                                                            <FileVideo
                                                                                                className={cn(
                                                                                                    'h-4 w-4',
                                                                                                    isUser
                                                                                                        ? undefined
                                                                                                        : 'text-muted-foreground'
                                                                                                )}
                                                                                            />
                                                                                            <span>
                                                                                                Video
                                                                                                attachment
                                                                                            </span>
                                                                                        </div>
                                                                                        <div className="w-full max-w-md">
                                                                                            <video
                                                                                                controls
                                                                                                src={
                                                                                                    src
                                                                                                }
                                                                                                className="w-full max-h-[360px] rounded-lg bg-black"
                                                                                                preload="metadata"
                                                                                            />
                                                                                        </div>
                                                                                        {(filename ||
                                                                                            mimeType) && (
                                                                                            <div className="flex flex-col text-xs">
                                                                                                {filename && (
                                                                                                    <span
                                                                                                        className={cn(
                                                                                                            'truncate',
                                                                                                            isUser
                                                                                                                ? 'text-primary-foreground/80'
                                                                                                                : 'text-muted-foreground'
                                                                                                        )}
                                                                                                    >
                                                                                                        {
                                                                                                            filename
                                                                                                        }
                                                                                                    </span>
                                                                                                )}
                                                                                                {mimeType && (
                                                                                                    <span
                                                                                                        className={cn(
                                                                                                            isUser
                                                                                                                ? 'text-primary-foreground/70'
                                                                                                                : 'text-muted-foreground/80'
                                                                                                        )}
                                                                                                    >
                                                                                                        {
                                                                                                            mimeType
                                                                                                        }
                                                                                                    </span>
                                                                                                )}
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                );
                                                                            }
                                                                            if (isFilePart(part)) {
                                                                                const filePart =
                                                                                    part;
                                                                                if (
                                                                                    filePart.mimeType.startsWith(
                                                                                        'audio/'
                                                                                    )
                                                                                ) {
                                                                                    const src =
                                                                                        resolveMediaSrc(
                                                                                            filePart,
                                                                                            toolResourceStates
                                                                                        );
                                                                                    return (
                                                                                        <div
                                                                                            key={
                                                                                                partKey
                                                                                            }
                                                                                            className="my-2 flex items-center gap-2 p-3 rounded-lg border border-border bg-muted/50"
                                                                                        >
                                                                                            <FileAudio
                                                                                                className={cn(
                                                                                                    'h-5 w-5',
                                                                                                    isUser
                                                                                                        ? undefined
                                                                                                        : 'text-muted-foreground'
                                                                                                )}
                                                                                            />
                                                                                            <audio
                                                                                                controls
                                                                                                src={
                                                                                                    src
                                                                                                }
                                                                                                className="flex-1 h-8"
                                                                                            />
                                                                                            {filePart.filename && (
                                                                                                <span
                                                                                                    className={cn(
                                                                                                        'text-sm truncate max-w-[120px]',
                                                                                                        isUser
                                                                                                            ? 'text-primary-foreground/80'
                                                                                                            : 'text-muted-foreground'
                                                                                                    )}
                                                                                                >
                                                                                                    {
                                                                                                        filePart.filename
                                                                                                    }
                                                                                                </span>
                                                                                            )}
                                                                                        </div>
                                                                                    );
                                                                                } else {
                                                                                    // Non-audio files (PDFs, etc.)
                                                                                    return (
                                                                                        <div
                                                                                            key={
                                                                                                partKey
                                                                                            }
                                                                                            className="my-2 flex items-center gap-2 p-3 rounded-lg border border-border bg-muted/50"
                                                                                        >
                                                                                            <File
                                                                                                className={cn(
                                                                                                    'h-5 w-5',
                                                                                                    isUser
                                                                                                        ? undefined
                                                                                                        : 'text-muted-foreground'
                                                                                                )}
                                                                                            />
                                                                                            <span
                                                                                                className={cn(
                                                                                                    'text-sm font-medium',
                                                                                                    isUser
                                                                                                        ? undefined
                                                                                                        : undefined
                                                                                                )}
                                                                                            >
                                                                                                {filePart.filename ||
                                                                                                    `${filePart.mimeType} file`}
                                                                                            </span>
                                                                                            <span
                                                                                                className={cn(
                                                                                                    'text-xs',
                                                                                                    isUser
                                                                                                        ? 'text-primary-foreground/70'
                                                                                                        : 'text-muted-foreground'
                                                                                                )}
                                                                                            >
                                                                                                {
                                                                                                    filePart.mimeType
                                                                                                }
                                                                                            </span>
                                                                                        </div>
                                                                                    );
                                                                                }
                                                                            }
                                                                            return null;
                                                                        }
                                                                    )}
                                                                </>
                                                            );
                                                        })()}
                                                    {/* Display imageData attachments if not already in content array */}
                                                    {isUserMessage(msg) &&
                                                        msg.imageData &&
                                                        !Array.isArray(msg.content) &&
                                                        (() => {
                                                            const src = `data:${msg.imageData.mimeType};base64,${msg.imageData.image}`;
                                                            if (!isValidDataUri(src, 'image')) {
                                                                return null;
                                                            }
                                                            return (
                                                                <img
                                                                    src={src}
                                                                    alt="attachment"
                                                                    className="mt-2 max-h-60 w-full rounded-lg border border-border object-contain"
                                                                />
                                                            );
                                                        })()}
                                                    {/* Display fileData attachments if not already in content array */}
                                                    {isUserMessage(msg) &&
                                                        msg.fileData &&
                                                        !Array.isArray(msg.content) && (
                                                            <div className="mt-2">
                                                                {msg.fileData.mimeType.startsWith(
                                                                    'video/'
                                                                ) ? (
                                                                    <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-muted/50 max-w-md">
                                                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                                            <FileVideo className="h-4 w-4" />
                                                                            <span>
                                                                                Video attachment
                                                                            </span>
                                                                        </div>
                                                                        {(() => {
                                                                            const videoSrc = `data:${msg.fileData.mimeType};base64,${msg.fileData.data}`;
                                                                            return isValidDataUri(
                                                                                videoSrc,
                                                                                'video'
                                                                            ) ? (
                                                                                <video
                                                                                    controls
                                                                                    src={videoSrc}
                                                                                    className="w-full max-h-[360px] rounded-lg bg-black"
                                                                                    preload="metadata"
                                                                                />
                                                                            ) : (
                                                                                <div className="text-xs text-red-500">
                                                                                    Invalid video
                                                                                    data
                                                                                </div>
                                                                            );
                                                                        })()}
                                                                        <div className="flex items-center gap-2 text-xs text-muted-foreground/90">
                                                                            <span className="font-medium truncate">
                                                                                {msg.fileData
                                                                                    .filename ||
                                                                                    `${msg.fileData.mimeType} file`}
                                                                            </span>
                                                                            <span className="opacity-70">
                                                                                {
                                                                                    msg.fileData
                                                                                        .mimeType
                                                                                }
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                ) : msg.fileData.mimeType.startsWith(
                                                                      'audio/'
                                                                  ) ? (
                                                                    <div className="relative w-fit border border-border rounded-lg p-2 bg-muted/50 flex items-center gap-2 group">
                                                                        <FileAudio className="h-4 w-4" />
                                                                        {(() => {
                                                                            const audioSrc = `data:${msg.fileData.mimeType};base64,${msg.fileData.data}`;
                                                                            return isValidDataUri(
                                                                                audioSrc,
                                                                                'audio'
                                                                            ) ? (
                                                                                <audio
                                                                                    controls
                                                                                    src={audioSrc}
                                                                                    className="h-8"
                                                                                />
                                                                            ) : (
                                                                                <span className="text-xs text-red-500">
                                                                                    Invalid audio
                                                                                    data
                                                                                </span>
                                                                            );
                                                                        })()}
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center gap-2 p-3 rounded-lg border border-border bg-muted/50">
                                                                        <File className="h-5 w-5" />
                                                                        <span className="text-sm font-medium">
                                                                            {msg.fileData
                                                                                .filename ||
                                                                                `${msg.fileData.mimeType} file`}
                                                                        </span>
                                                                        <span className="text-xs text-primary-foreground/70">
                                                                            {msg.fileData.mimeType}
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    {/* Metadata bar: show for user messages always, for AI only on last message of run */}
                                    {!isToolRelated && (isUser || showAssistantMetadata) && (
                                        <div className="text-xs text-muted-foreground mt-1 px-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span>{timestampStr}</span>
                                                {(() => {
                                                    if (!showAssistantMetadata) return null;
                                                    const runTokens = getRunTokenUsage(idx);
                                                    if (runTokens.totalTokens === 0) return null;
                                                    return (
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/50 text-xs cursor-default">
                                                                    <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                                                                    {runTokens.totalTokens} tokens
                                                                </span>
                                                            </TooltipTrigger>
                                                            <TooltipContent side="bottom">
                                                                <div className="flex flex-col gap-0.5">
                                                                    {runTokens.inputTokens > 0 && (
                                                                        <div>
                                                                            Input:{' '}
                                                                            {runTokens.inputTokens}
                                                                        </div>
                                                                    )}
                                                                    {runTokens.outputTokens > 0 && (
                                                                        <div>
                                                                            Output:{' '}
                                                                            {runTokens.outputTokens}
                                                                        </div>
                                                                    )}
                                                                    {runTokens.reasoningTokens >
                                                                        0 && (
                                                                        <div>
                                                                            Reasoning:{' '}
                                                                            {
                                                                                runTokens.reasoningTokens
                                                                            }
                                                                        </div>
                                                                    )}
                                                                    <div className="font-medium mt-0.5">
                                                                        Total:{' '}
                                                                        {runTokens.totalTokens}
                                                                    </div>
                                                                </div>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    );
                                                })()}
                                                {showAssistantMetadata && msg.model && (
                                                    <Tooltip>
                                                        <TooltipTrigger>
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/30 text-xs cursor-default">
                                                                {msg.model}
                                                            </span>
                                                        </TooltipTrigger>
                                                        <TooltipContent side="bottom">
                                                            <div className="space-y-1">
                                                                <div className="font-medium">
                                                                    Model: {msg.model}
                                                                </div>
                                                                {msg.provider && (
                                                                    <div className="font-medium">
                                                                        Provider: {msg.provider}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                )}
                                            </div>
                                            {/* Speak + Copy controls */}
                                            <div className="flex items-center gap-1 shrink-0">
                                                <CopyButton
                                                    value={
                                                        isUser
                                                            ? getPlainTextFromMessage(msg)
                                                            : getRunAssistantText(idx)
                                                    }
                                                    tooltip={
                                                        isUser ? 'Copy message' : 'Copy response'
                                                    }
                                                    copiedTooltip="Copied!"
                                                    className="opacity-70 hover:opacity-100 transition-opacity"
                                                />
                                                <SpeakButton
                                                    value={
                                                        isUser
                                                            ? getPlainTextFromMessage(msg)
                                                            : getRunAssistantText(idx)
                                                    }
                                                    tooltip="Speak"
                                                    stopTooltip="Stop"
                                                    className="opacity-70 hover:opacity-100 transition-opacity"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            {/* Render tool result images inline */}
                            {toolResultImages.map((image, imageIndex) => (
                                <div key={`${msgKey}-image-${imageIndex}`} className="mt-3 pl-9">
                                    <div
                                        className="relative group cursor-pointer inline-block"
                                        onClick={() => openImageModal(image.src, image.alt)}
                                    >
                                        <img
                                            src={image.src}
                                            alt={image.alt}
                                            className="max-h-80 max-w-full w-auto rounded-lg object-contain transition-transform group-hover:scale-[1.01]"
                                        />
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors rounded-lg flex items-center justify-center">
                                            <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-80 transition-opacity drop-shadow-lg" />
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* Render tool result videos inline */}
                            {toolResultVideos.map((video, videoIndex) => (
                                <div key={`${msgKey}-video-${videoIndex}`} className="mt-3 pl-9">
                                    <video
                                        controls
                                        src={video.src}
                                        className="max-w-full max-h-[360px] rounded-lg bg-black"
                                        preload="metadata"
                                    />
                                    {video.filename && (
                                        <div className="text-xs text-muted-foreground mt-1 truncate">
                                            {video.filename}
                                        </div>
                                    )}
                                </div>
                            ))}

                            {/* Render tool result audio inline */}
                            {toolResultAudios.map((audio, audioIndex) => (
                                <div key={`${msgKey}-audio-${audioIndex}`} className="mt-3 pl-9">
                                    <audio
                                        controls
                                        src={audio.src}
                                        className="max-w-full rounded-lg"
                                        preload="metadata"
                                    />
                                    {audio.filename && (
                                        <div className="text-xs text-muted-foreground mt-1 truncate">
                                            {audio.filename}
                                        </div>
                                    )}
                                </div>
                            ))}

                            {/* Render tool result UI resources (MCP-UI interactive content) */}
                            {toolResultUIResources.map((uiResource, uiIndex) => (
                                <div
                                    key={`${msgKey}-ui-resource-${uiIndex}`}
                                    className="w-full mt-2"
                                >
                                    <div className="flex flex-col items-start w-full">
                                        <div className="w-full max-w-[90%] bg-card text-card-foreground border border-border rounded-xl shadow-sm overflow-hidden">
                                            <UIResourceRendererWrapper
                                                resource={uiResource.resource}
                                                onAction={(action) => {
                                                    // Log UI actions for debugging
                                                    console.log(`MCP-UI Action: ${action}`);
                                                }}
                                            />
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-1 px-1">
                                            <span>{timestampStr}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {errorAnchoredHere && (
                                <div className="mt-2 ml-12 mr-4">
                                    {/* indent to align under bubbles */}
                                    <ErrorBanner
                                        error={activeError!}
                                        onDismiss={onDismissError || (() => {})}
                                    />
                                </div>
                            )}
                        </div>
                    </React.Fragment>
                );
            })}

            {/* Render todo panel when there are todos */}
            {sessionId && <TodoPanel sessionId={sessionId} />}

            {/* Show thinking indicator while processing */}
            {processing && <ThinkingIndicator toolName={currentToolName} />}

            {/* Note: Approvals are now rendered inline within tool messages via ToolCallTimeline */}

            <div key="end-anchor" ref={endRef} className="h-px" />

            {/* Image Modal */}
            {imageModal.isOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 cursor-pointer"
                    onClick={closeImageModal}
                >
                    <button
                        onClick={closeImageModal}
                        className="absolute top-4 right-4 p-2 text-white/70 hover:text-white transition-colors"
                        aria-label="Close modal"
                    >
                        <X className="h-6 w-6" />
                    </button>
                    <img
                        src={imageModal.src}
                        alt={imageModal.alt}
                        className="max-w-[90vw] max-h-[90vh] object-contain"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
}

function extractResourceData(
    text: string,
    resourceSet: Record<string, ResourceMetadata>
): { cleanedText: string; uris: string[] } {
    if (!text) {
        return { cleanedText: '', uris: [] };
    }

    // Parse references using core function
    const references = parseResourceReferences(text);

    // Resolve references using core function
    const resolved = resolveResourceReferences(references, resourceSet);

    // Extract URIs from resolved references (filter out unresolved ones and deduplicate)
    const resolvedUris = Array.from(
        new Set(resolved.filter((ref) => ref.resourceUri).map((ref) => ref.resourceUri!))
    );

    // Clean the text by removing ALL resolved reference formats using originalRef
    // This handles @<uri>, @name, and @server:resource patterns
    // Only clean resolved references - leave unresolved ones visible to user
    let cleanedText = text;
    for (const ref of resolved) {
        if (ref.resourceUri) {
            // Use split/join to avoid regex escaping issues and handle all occurrences
            cleanedText = cleanedText.split(ref.originalRef).join('');
        }
    }

    // Unescape literal \n and \t strings to actual newlines/tabs
    cleanedText = cleanedText.replace(/\\n/g, '\n').replace(/\\t/g, '\t');

    // Clean up extra whitespace and newlines
    cleanedText = cleanedText
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ') // Only collapse spaces/tabs, not newlines
        .trim();

    return { cleanedText, uris: resolvedUris };
}

function MessageContentWithResources({
    text,
    isUser,
    onOpenImage,
    resourceSet,
}: {
    text: string;
    isUser: boolean;
    onOpenImage: (src: string, alt: string) => void;
    resourceSet: Record<string, ResourceMetadata>;
}) {
    const { cleanedText, uris } = useMemo(
        () => extractResourceData(text, resourceSet),
        [text, resourceSet]
    );
    const resourceStates = useResourceContent(uris);
    const hasText = cleanedText.length > 0;

    return (
        <div className="space-y-3">
            {hasText && (
                <div className="relative min-w-0 overflow-hidden">
                    {isUser ? (
                        <p className="text-base whitespace-pre-line break-words overflow-wrap-anywhere">
                            {cleanedText}
                        </p>
                    ) : (
                        <MarkdownText>{cleanedText}</MarkdownText>
                    )}
                </div>
            )}

            {uris.map((uri) => (
                <ResourceAttachment
                    key={uri}
                    uri={uri}
                    state={resourceStates[uri]}
                    onOpenImage={onOpenImage}
                />
            ))}
        </div>
    );
}

function ResourceAttachment({
    uri,
    state,
    onOpenImage,
}: {
    uri: string;
    state?: ResourceState;
    onOpenImage: (src: string, alt: string) => void;
}) {
    if (!state || state.status === 'loading') {
        return (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Loading resource…</span>
            </div>
        );
    }

    if (state.status === 'error') {
        return (
            <div className="flex items-start gap-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
                <div className="space-y-1">
                    <p className="font-medium">Failed to load resource</p>
                    <p className="break-all text-[11px] text-destructive/80">{uri}</p>
                    <p className="text-[11px] text-destructive/70">{state.error}</p>
                </div>
            </div>
        );
    }

    const data = state.data;
    if (!data || data.items.length === 0) {
        return (
            <div className="text-xs text-muted-foreground">
                <p className="font-medium">{data?.name || uri}</p>
                <p className="text-[11px] text-muted-foreground/80">No previewable content.</p>
            </div>
        );
    }

    const primaryMime = data.items.find(
        (item): item is NormalizedResourceItem & { mimeType: string } =>
            'mimeType' in item && typeof item.mimeType === 'string'
    )?.mimeType;

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground/80">
                <Info className="h-3.5 w-3.5" />
                <span className="font-medium text-foreground">{data.name || uri}</span>
                {primaryMime && <span className="text-[10px]">{primaryMime}</span>}
            </div>

            {data.items.map((item, index) =>
                renderNormalizedItem({
                    item,
                    index,
                    onOpenImage,
                })
            )}
        </div>
    );
}

function renderNormalizedItem({
    item,
    index,
    onOpenImage,
}: {
    item: NormalizedResourceItem;
    index: number;
    onOpenImage: (src: string, alt: string) => void;
}) {
    const key = `resource-item-${index}`;

    switch (item.kind) {
        case 'text': {
            if (item.mimeType && item.mimeType.includes('markdown')) {
                return (
                    <div key={key} className="text-sm">
                        <MarkdownText>{item.text}</MarkdownText>
                    </div>
                );
            }
            return (
                <pre
                    key={key}
                    className="whitespace-pre-wrap break-words rounded-md bg-background/60 p-2 text-sm text-foreground"
                >
                    {item.text}
                </pre>
            );
        }
        case 'image': {
            if (!isSafeMediaUrl(item.src)) {
                return (
                    <div key={key} className="text-xs text-muted-foreground">
                        Unsupported image source
                    </div>
                );
            }
            return (
                <img
                    key={key}
                    src={item.src}
                    alt={item.alt || 'Resource image'}
                    onClick={() => onOpenImage(item.src, item.alt || 'Resource image')}
                    className="max-h-60 w-full cursor-zoom-in rounded-lg border border-border object-contain"
                />
            );
        }
        case 'audio': {
            if (!isSafeAudioUrl(item.src)) {
                return (
                    <div key={key} className="text-xs text-muted-foreground">
                        Unsupported audio source
                    </div>
                );
            }
            return (
                <div
                    key={key}
                    className="flex items-center gap-2 rounded-lg border border-border bg-background/50 p-2"
                >
                    <FileAudio className="h-4 w-4" />
                    <audio controls src={item.src} className="h-8 flex-1" />
                    {item.filename && (
                        <span className="max-w-[140px] truncate text-xs text-muted-foreground">
                            {item.filename}
                        </span>
                    )}
                </div>
            );
        }
        case 'video': {
            if (!isSafeMediaUrl(item.src, 'video')) {
                return (
                    <div key={key} className="text-xs text-muted-foreground">
                        Unsupported video source
                    </div>
                );
            }
            return (
                <div
                    key={key}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-background/50 p-3"
                >
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <FileVideo className="h-4 w-4" />
                        <span>Video</span>
                        {item.filename && (
                            <span className="truncate font-medium">{item.filename}</span>
                        )}
                    </div>
                    <video
                        controls
                        src={item.src}
                        className="w-full max-h-[360px] rounded-lg bg-black"
                        preload="metadata"
                    >
                        Your browser does not support the video tag.
                    </video>
                </div>
            );
        }
        case 'file': {
            return (
                <div
                    key={key}
                    className="flex items-center gap-3 rounded-lg border border-border bg-background/60 p-2"
                >
                    <File className="h-4 w-4 text-muted-foreground" />
                    <div className="flex flex-1 flex-col">
                        <span className="text-sm font-medium text-foreground">
                            {item.filename || 'Resource file'}
                        </span>
                        {item.mimeType && (
                            <span className="text-[11px] text-muted-foreground">
                                {item.mimeType}
                            </span>
                        )}
                    </div>
                    {item.src && (
                        <a
                            href={item.src}
                            download={item.filename || 'resource.bin'}
                            className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                        >
                            Download
                        </a>
                    )}
                </div>
            );
        }
        default:
            return null;
    }
}
