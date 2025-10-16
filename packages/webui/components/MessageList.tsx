'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from "@/lib/utils";
import {
    Message,
    TextPart,
    AudioPart,
    isToolResultError,
    isToolResultContent,
    isTextPart,
    isImagePart,
    isAudioPart,
    isFilePart,
    ErrorMessage,
    ToolResult
} from './hooks/useChat';
import { getFileMediaKind } from '@dexto/core';
import ErrorBanner from './ErrorBanner';
import {
    User,
    Bot,
    ChevronsRight,
    ChevronUp,
    Loader2,
    CheckCircle,
    ChevronRight,
    Wrench,
    AlertTriangle,
    Image as ImageIcon,
    Info,
    File,
    FileAudio,
    Copy,
    ChevronDown,
    Brain,
    Check as CheckIcon,
    X,
    ZoomIn,
    Volume2,
    Video as VideoIcon,
    FileVideo,
} from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { MarkdownText } from './ui/markdown-text';
import { TooltipIconButton } from './ui/tooltip-icon-button';
import { CopyButton } from './ui/copy-button';
import { SpeakButton } from './ui/speak-button';
import { useResourceContent, type ResourceState, type NormalizedResourceItem } from './hooks/useResourceContent';
import { useResources } from './hooks/useResources';
import type { ResourceMetadata } from '@dexto/core';
import { parseResourceReferences, resolveResourceReferences } from '@dexto/core';
import { type ApprovalEvent } from './ToolConfirmationHandler';
import { InlineApprovalCard } from './InlineApprovalCard';

interface MessageListProps {
  messages: Message[];
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
}

// Helper to format timestamp from createdAt
const formatTimestamp = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// Helper to validate data URIs to prevent XSS
function isValidDataUri(src: string, expectedType?: 'image' | 'video' | 'audio'): boolean {
  const typePattern = expectedType ? `${expectedType}/` : '[a-z0-9.+-]+/';
  const dataUriRegex = new RegExp(`^data:${typePattern}[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$`, 'i');
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
      if (hostname.startsWith('fe8') || hostname.startsWith('fe9') || 
          hostname.startsWith('fea') || hostname.startsWith('feb')) {
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
      : part?.data ?? part?.base64 ?? part?.image ?? part?.audio ?? part?.video ?? part?.uri ?? part?.url;

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

          if (preferredItem && 'src' in preferredItem && typeof preferredItem.src === 'string') {
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


function ThinkingIndicator() {
  return (
    <div className="flex items-center justify-center gap-2 py-1 text-xs text-muted-foreground" role="status" aria-live="polite">
      <span className="flex items-center gap-1 uppercase tracking-wide text-muted-foreground/80">
        <span>Thinking</span>
        <span className="flex items-center gap-0.5">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="inline-flex h-1.5 w-1.5 rounded-full bg-primary/60 animate-[pulse_1.2s_ease-in-out_infinite]"
              style={{ animationDelay: `${dot * 0.18}s` }}
            />
          ))}
        </span>
      </span>
    </div>
  );
}

export default function MessageList({ messages, activeError, onDismissError, outerRef, pendingApproval, onApprovalApprove, onApprovalDeny }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const [manuallyExpanded, setManuallyExpanded] = useState<Record<string, boolean>>({});
  const [reasoningExpanded, setReasoningExpanded] = useState<Record<string, boolean>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [imageModal, setImageModal] = useState<{ isOpen: boolean; src: string; alt: string }>({
    isOpen: false,
    src: '',
    alt: ''
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
    if (msg.content && typeof msg.content === 'object') return JSON.stringify(msg.content, null, 2);
    return '';
  };

  const getToolResultCopyText = (result: ToolResult | undefined): string => {
    if (!result) return '';
    if (isToolResultError(result)) {
      return typeof result.error === 'object' ? JSON.stringify(result.error, null, 2) : String(result.error);
    }
    if (isToolResultContent(result)) {
      return result.content
        .map((part) => (isTextPart(part) ? part.text : typeof part === 'object' ? '' : String(part)))
        .filter(Boolean)
        .join('\n');
    }
    return typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
  };

  return (
    <div id="message-list-container" ref={outerRef} className="flex flex-col space-y-3 px-4 py-2">
      {messages.map((msg, idx) => {
        const msgKey = msg.id ?? `msg-${idx}`;
        const isUser = msg.role === 'user';
        const isAi = msg.role === 'assistant';
        const isSystem = msg.role === 'system';
        const isThinkingMessage =
          isSystem && typeof msg.content === 'string' && msg.content.trim().toLowerCase().startsWith('dexto is thinking');

        const isLastMessage = idx === messages.length - 1;
        const isToolCall = !!(msg.toolName && msg.toolArgs);
        const isToolResult = !!(msg.toolName && msg.toolResult);
        const isToolRelated = isToolCall || isToolResult;

        const isExpanded = (isToolRelated && isLastMessage) || !!manuallyExpanded[msgKey];

        // Extract media parts from tool results for separate rendering
        const toolResultImages: Array<{ src: string; alt: string; index: number }> = [];
        const toolResultAudios: Array<{ src: string; filename?: string; index: number }> = [];
        const toolResultVideos: Array<{ src: string; filename?: string; mimeType?: string; index: number }> = [];
        if (isToolResult && msg.toolResult && isToolResultContent(msg.toolResult)) {
          msg.toolResult.content.forEach((part, index) => {
            if (isImagePart(part)) {
              const src = resolveMediaSrc(part, toolResourceStates);
              
              if (src && isSafeMediaUrl(src, 'image')) {
                toolResultImages.push({
                  src,
                  alt: `Tool result image ${index + 1}`,
                  index
                });
              }
            } else if (isAudioPart(part)) {
              const audio = part as AudioPart;
              const src = resolveMediaSrc(audio, toolResourceStates);
              
              if (src && isSafeMediaUrl(src, 'audio')) {
                toolResultAudios.push({
                  src,
                  filename: audio.filename,
                  index
                });
              }
            } else if (
              isFilePart(part) &&
              (getFileMediaKind(part.mimeType) === 'audio' || part.mimeType?.startsWith('audio/'))
            ) {
              const src = resolveMediaSrc(part, toolResourceStates);
              if (src && isSafeMediaUrl(src, 'audio')) {
                toolResultAudios.push({
                  src,
                  filename: part.filename,
                  index
                });
              }
            } else {
              const videoInfo = getVideoInfo(part, toolResourceStates);
              if (videoInfo) {
                toolResultVideos.push({
                  ...videoInfo,
                  index
                });
              }
            }
          });
        }

        const toggleManualExpansion = () => {
          if (isToolRelated) {
            setManuallyExpanded(prev => ({
              ...prev,
              [msgKey]: !prev[msgKey]
            }));
          }
        };

        const AvatarComponent = isUser ? User : Bot;

        const messageContainerClass = cn(
          isUser
            ? "grid w-full grid-cols-[1fr_auto] gap-x-2 items-start"
            : "grid w-full grid-cols-[auto_1fr] gap-x-2 items-start",
        );

        // Bubble styling: users and AI are speech bubbles; tools are full-width transient blocks
        const bubbleSpecificClass = cn(
          msg.role === 'tool'
            ? "w-full text-muted-foreground/70 bg-secondary border border-muted/30 rounded-md text-base"
            : isUser
            ? "p-3 rounded-xl shadow-sm w-fit max-w-[75%] bg-primary text-primary-foreground rounded-br-none text-base break-normal hyphens-none"
            : isAi
            ? "p-3 rounded-xl shadow-sm w-fit max-w-[90%] bg-card text-card-foreground border border-border rounded-bl-none text-base break-normal hyphens-none"
            : isSystem
            ? isThinkingMessage
              ? "p-1.5 shadow-none w-full bg-transparent text-xs text-muted-foreground text-center border-none"
              : "p-3 shadow-none w-full bg-transparent text-xs text-muted-foreground italic text-center border-none"
            : "",
        );

        const contentWrapperClass = "flex flex-col gap-2";
        const timestampStr = formatTimestamp(msg.createdAt);

        const errorAnchoredHere = !!(activeError && activeError.anchorMessageId === msg.id);

        // (Provider not available on Message type)

        return (
          <div key={msgKey} className="w-full" data-role={msg.role} id={msg.id ? `message-${msg.id}` : undefined}>
            <div className={messageContainerClass}>
              {isAi && (
                <AvatarComponent className="h-7 w-7 mt-1 text-muted-foreground col-start-1" />
              )}
              {msg.role === 'tool' && (
                <Wrench className="h-7 w-7 p-1 mt-1 rounded-full border border-border text-muted-foreground col-start-1" />
              )}

              <div
                className={cn(
                  "flex flex-col group w-full",
                  isSystem
                    ? "col-span-2 items-center"
                    : isUser
                    ? "col-start-1 justify-self-end items-end"
                    : "col-start-2 justify-self-start items-start",
                )}
              >
                <div className={bubbleSpecificClass}>
                  <div className={contentWrapperClass}>
                  {/* Reasoning panel (assistant only) - display at top */}
                  {isAi && typeof msg.reasoning === 'string' && msg.reasoning.trim().length > 0 && (
                    <div className="mb-3 border border-orange-200/50 dark:border-orange-400/20 rounded-lg bg-gradient-to-br from-orange-50/30 to-amber-50/20 dark:from-orange-900/20 dark:to-amber-900/10">
                      <div className="px-3 py-2 border-b border-orange-200/30 dark:border-orange-400/20 bg-orange-100/50 dark:bg-orange-900/30 rounded-t-lg flex items-center justify-between">
                        <button
                          type="button"
                          className="flex items-center gap-2 text-xs font-medium text-orange-700 dark:text-orange-300 hover:text-orange-800 dark:hover:text-orange-200 transition-colors group"
                          onClick={() =>
                            setReasoningExpanded((prev) => ({
                              ...prev,
                              [msgKey]: !(prev[msgKey] ?? true),
                            }))
                          }
                        >
                          <Brain className="h-3.5 w-3.5" />
                          <span>AI Reasoning</span>
                          {(reasoningExpanded[msgKey] ?? true) ? (
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
                  
                  {msg.toolName ? (
                    <div className="p-2 rounded border border-border bg-muted/30 hover:bg-muted/60 cursor-pointer w-full" onClick={toggleManualExpansion}>
                      <div className="flex items-center justify-between text-xs font-medium">
                        <span className="flex items-center">
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 mr-2 text-primary" />
                          ) : (
                            <ChevronRight className="h-4 w-4 mr-2 text-primary" />
                          )}
                          Tool: {msg.toolName}
                        </span>
                        {msg.toolResult ? (
                          isToolResultError(msg.toolResult) ? (
                            <AlertTriangle className="mx-2 h-4 w-4 text-red-500" />
                          ) : (
                            <CheckCircle className="mx-2 h-4 w-4 text-green-500" />
                          )
                        ) : (
                          <Loader2 className="mx-2 h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      {isExpanded && (
                        <div className="mt-2 space-y-2">
                          <div>
                            <p className="text-xs font-medium">Arguments:</p>
                            <pre className="whitespace-pre-wrap break-words overflow-auto bg-background/50 p-2 rounded text-xs text-muted-foreground">
                              {JSON.stringify(msg.toolArgs, null, 2)}
                            </pre>
                          </div>
                          {msg.toolResult && (
                            <div>
                              <div className="text-xs font-medium flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                                <span>Result:</span>
                                <div className="flex items-center gap-1">
                                  <CopyButton
                                    value={getToolResultCopyText(msg.toolResult)}
                                    tooltip="Copy result"
                                    copiedTooltip="Copied!"
                                    className="opacity-70 hover:opacity-100 transition-opacity"
                                  />
                                  <SpeakButton
                                    value={getToolResultCopyText(msg.toolResult)}
                                    tooltip="Speak result"
                                    stopTooltip="Stop"
                                    className="opacity-70 hover:opacity-100 transition-opacity"
                                  />
                                </div>
                              </div>
                              {isToolResultError(msg.toolResult) ? (
                                <pre className="whitespace-pre-wrap break-words overflow-auto bg-red-100 text-red-700 p-2 rounded text-xs">
                                  {typeof msg.toolResult.error === 'object'
                                    ? JSON.stringify(msg.toolResult.error, null, 2)
                                    : String(msg.toolResult.error)}
                                </pre>
                              ) : isToolResultContent(msg.toolResult) ? (
                                msg.toolResult.content.map((part, index) => {
                                  const videoInfo = getVideoInfo(part, toolResourceStates);
                                  // Skip media parts (image/audio/video) as they render separately
                                  if (
                                    isImagePart(part) ||
                                    isAudioPart(part) ||
                                    (isFilePart(part) &&
                                        (getFileMediaKind(part.mimeType) === 'audio' ||
                                            part.mimeType?.startsWith('audio/'))) ||
                                    videoInfo
                                  ) {
                                    return null;
                                  }
                                  if (isTextPart(part)) {
                                    return (
                                      <MessageContentWithResources
                                        key={`${msgKey}-tool-text-${index}`}
                                        text={part.text}
                                        isUser={false}
                                        onOpenImage={openImageModal}
                                        resourceSet={resourceSet}
                                      />
                                    );
                                  }
                                  if (isFilePart(part)) {
                                    const mediaKind = getFileMediaKind(part.mimeType);
                                    const isAudioFile =
                                      mediaKind === 'audio' ||
                                      part.mimeType?.startsWith('audio/');
                                    const isVideoFile =
                                      mediaKind === 'video' ||
                                      part.mimeType?.startsWith('video/');
                                    return (
                                      <div key={index} className="my-1 flex items-center gap-2 p-2 rounded border border-border bg-muted/50">
                                        {isAudioFile ? (
                                          <FileAudio className="h-4 w-4 text-muted-foreground" />
                                        ) : isVideoFile ? (
                                          <FileVideo className="h-4 w-4 text-muted-foreground" />
                                        ) : (
                                          <File className="h-4 w-4 text-muted-foreground" />
                                        )}
                                        <span className="text-xs text-muted-foreground">
                                          {part.filename || 'File attachment'} ({part.mimeType})
                                        </span>
                                      </div>
                                    );
                                  }
                                  return (
                                    <pre key={index} className="whitespace-pre-wrap break-words overflow-auto bg-background/50 p-2 rounded text-xs text-muted-foreground my-1">
                                      {typeof part === 'object' ? JSON.stringify(part, null, 2) : String(part)}
                                    </pre>
                                  );
                                })
                              ) : (
                                <pre className="whitespace-pre-wrap break-words overflow-auto bg-background/50 p-2 rounded text-xs text-muted-foreground">
                                  {typeof msg.toolResult === 'string' && msg.toolResult.startsWith('data:image') 
                                    ? (isValidDataUri(msg.toolResult, 'image') ? <img src={msg.toolResult} alt="Tool result image" className="my-1 max-h-48 w-auto rounded border border-border" /> : 'Invalid image data')
                                    : typeof msg.toolResult === 'object' ? JSON.stringify(msg.toolResult, null, 2) : String(msg.toolResult)}
                                </pre>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {typeof msg.content === 'string' && msg.content.trim() !== '' && (
                        <div className="relative">
                          {isThinkingMessage ? (
                            <ThinkingIndicator />
                          ) : (
                            <MessageContentWithResources
                              key={`${msgKey}-text-content`}
                              text={msg.content}
                              isUser={isUser}
                              onOpenImage={openImageModal}
                              resourceSet={resourceSet}
                            />
                          )}
                        </div>
                      )}

                      {msg.content && typeof msg.content === 'object' && !Array.isArray(msg.content) && (
                        <pre className="whitespace-pre-wrap break-words overflow-auto bg-background/50 p-2 rounded text-xs text-muted-foreground">
                          {JSON.stringify(msg.content, null, 2)}
                        </pre>
                      )}

                      {Array.isArray(msg.content) && msg.content.map((part, partIdx) => {
                        const partKey = `${msgKey}-part-${partIdx}`;
                        if (part.type === 'text') {
                          return (
                            <MessageContentWithResources
                              key={partKey}
                              text={(part as TextPart).text}
                              isUser={isUser}
                              onOpenImage={openImageModal}
                              resourceSet={resourceSet}
                            />
                          );
                        }
                        // Handle image parts
                        if (isImagePart(part)) {
                          const src = resolveMediaSrc(part);
                          if (src && isSafeMediaUrl(src, 'image')) {
                            return (
                              <img
                                key={partKey}
                                src={src}
                                alt="Message attachment"
                                className="mt-2 max-h-60 w-full rounded-lg border border-border object-contain cursor-pointer"
                                onClick={() => openImageModal(src, "Message attachment")}
                              />
                            );
                          }
                          return null;
                        }

                        const videoInfo = getVideoInfo(part);
                        if (videoInfo) {
                          const { src, filename, mimeType } = videoInfo;
                          return (
                            <div key={partKey} className="my-2 flex flex-col gap-2 p-3 rounded-lg border border-border bg-muted/50">
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <FileVideo className={cn("h-4 w-4", isUser ? undefined : "text-muted-foreground")} />
                                <span>Video attachment</span>
                              </div>
                              <div className="w-full max-w-md">
                                <video
                                  controls
                                  src={src}
                                  className="w-full max-h-[360px] rounded-lg bg-black"
                                  preload="metadata"
                                />
                              </div>
                              {(filename || mimeType) && (
                                <div className="flex flex-col text-xs">
                                  {filename && (
                                    <span className={cn("truncate", isUser ? "text-primary-foreground/80" : "text-muted-foreground")}>
                                      {filename}
                                    </span>
                                  )}
                                  {mimeType && (
                                    <span className={cn(isUser ? "text-primary-foreground/70" : "text-muted-foreground/80")}>{mimeType}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        }
                        if (isFilePart(part)) {
                          const filePart = part;
                          if (filePart.mimeType.startsWith('audio/')) {
                            const src = resolveMediaSrc(filePart);
                            return (
                              <div key={partKey} className="my-2 flex items-center gap-2 p-3 rounded-lg border border-border bg-muted/50">
                                <FileAudio className={cn("h-5 w-5", isUser ? undefined : "text-muted-foreground")} />
                                <audio 
                                  controls 
                                  src={src} 
                                  className="flex-1 h-8"
                                />
                                {filePart.filename && (
                                  <span className={cn("text-sm truncate max-w-[120px]", isUser ? "text-primary-foreground/80" : "text-muted-foreground")}>
                                    {filePart.filename}
                                  </span>
                                )}
                              </div>
                            );
                          } else {
                            // Non-audio files (PDFs, etc.)
                            return (
                              <div key={partKey} className="my-2 flex items-center gap-2 p-3 rounded-lg border border-border bg-muted/50">
                                <File className={cn("h-5 w-5", isUser ? undefined : "text-muted-foreground")} />
                                <span className={cn("text-sm font-medium", isUser ? undefined : undefined)}>
                                  {filePart.filename || `${filePart.mimeType} file`}
                                </span>
                                <span className={cn("text-xs", isUser ? "text-primary-foreground/70" : "text-muted-foreground")}>
                                  {filePart.mimeType}
                                </span>
                              </div>
                            );
                          }
                        }
                        return null;
                      })}
                      {isSystem && !msg.content && (
                        <p className="italic">System message</p>
                      )}
                    </>
                  )}
                  {/* Display imageData attachments if not already in content array */}
                  {msg.imageData && !Array.isArray(msg.content) && (
                    (() => {
                      const src = `data:${msg.imageData.mimeType};base64,${msg.imageData.base64}`;
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
                    })()
                  )}
                  {/* Display fileData attachments if not already in content array */}
                  {msg.fileData && !Array.isArray(msg.content) && (
                    <div className="mt-2">
                      {msg.fileData.mimeType.startsWith('video/') ? (
                        <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-muted/50 max-w-md">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <FileVideo className="h-4 w-4" />
                            <span>Video attachment</span>
                          </div>
                          {(() => {
                            const videoSrc = `data:${msg.fileData.mimeType};base64,${msg.fileData.base64}`;
                            return isValidDataUri(videoSrc, 'video') ? (
                              <video
                                controls
                                src={videoSrc}
                                className="w-full max-h-[360px] rounded-lg bg-black"
                                preload="metadata"
                              />
                            ) : (
                              <div className="text-xs text-red-500">Invalid video data</div>
                            );
                          })()}
                          <div className="flex items-center gap-2 text-xs text-muted-foreground/90">
                            <span className="font-medium truncate">
                              {msg.fileData.filename || `${msg.fileData.mimeType} file`}
                            </span>
                            <span className="opacity-70">{msg.fileData.mimeType}</span>
                          </div>
                        </div>
                      ) : msg.fileData.mimeType.startsWith('audio/') ? (
                        <div className="relative w-fit border border-border rounded-lg p-2 bg-muted/50 flex items-center gap-2 group">
                          <FileAudio className="h-4 w-4" />
                          {(() => {
                            const audioSrc = `data:${msg.fileData.mimeType};base64,${msg.fileData.base64}`;
                            return isValidDataUri(audioSrc, 'audio') ? (
                              <audio controls src={audioSrc} className="h-8" />
                            ) : (
                              <span className="text-xs text-red-500">Invalid audio data</span>
                            );
                          })()}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 p-3 rounded-lg border border-border bg-muted/50">
                          <File className="h-5 w-5" />
                          <span className="text-sm font-medium">
                            {msg.fileData.filename || `${msg.fileData.mimeType} file`}
                          </span>
                          <span className="text-xs text-primary-foreground/70">
                            {msg.fileData.mimeType}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {!isSystem && !isToolRelated && (
                <div className="text-xs text-muted-foreground mt-1 px-1 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{timestampStr}</span>
                  {isAi && msg.tokenUsage?.totalTokens !== undefined && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/50 text-xs cursor-default">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                          {msg.tokenUsage.totalTokens} tokens
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <div className="flex flex-col gap-0.5">
                          {msg.tokenUsage.inputTokens !== undefined && (
                            <div>Input: {msg.tokenUsage.inputTokens}</div>
                          )}
                          {msg.tokenUsage.outputTokens !== undefined && (
                            <div>Output: {msg.tokenUsage.outputTokens}</div>
                          )}
                          {msg.tokenUsage.reasoningTokens !== undefined && (
                            <div>Reasoning: {msg.tokenUsage.reasoningTokens}</div>
                          )}
                          <div className="font-medium mt-0.5">Total: {msg.tokenUsage.totalTokens}</div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {isAi && msg.model && (
                    <Tooltip>
                      <TooltipTrigger>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/30 text-xs cursor-default">
                          {msg.model}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <div className="space-y-1">
                          <div className="font-medium">Model: {msg.model}</div>
                          {msg.provider && (
                            <div className="font-medium">Provider: {msg.provider}</div>
                          )}
                          {msg.router && (
                            <div className="font-medium">Router: {msg.router}</div>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {/* {msg.sessionId && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono bg-muted/20">
                      {msg.sessionId.slice(0, 8)}
                    </span>
                  )} */}
                  </div>
                  {/* Speak + Copy controls for user and AI messages */}
                  {(isAi || isUser) && (
                    <div className="flex items-center gap-1">
                      <CopyButton
                        value={getPlainTextFromMessage(msg)}
                        tooltip="Copy message"
                        copiedTooltip="Copied!"
                        className="opacity-70 hover:opacity-100 transition-opacity"
                      />
                      <SpeakButton
                        value={getPlainTextFromMessage(msg)}
                        tooltip="Speak"
                        stopTooltip="Stop"
                        className="opacity-70 hover:opacity-100 transition-opacity"
                      />
                    </div>
                  )}
                </div>
              )}
              </div>
              
              {isUser && (
                <AvatarComponent className="h-7 w-7 mt-1 text-muted-foreground col-start-2" />
              )}
            </div>
            {/* Render tool result images as separate message bubbles */}
            {toolResultImages.map((image, imageIndex) => (
              <div key={`${msgKey}-image-${imageIndex}`} className="w-full mt-2">
                <div className="flex items-end w-full justify-start">
                  <ImageIcon className="h-7 w-7 mr-2 mb-1 text-muted-foreground self-start flex-shrink-0" />
                  <div className="flex flex-col items-start">
                    <div className="p-3 rounded-xl shadow-sm max-w-[75%] bg-card text-card-foreground border border-border rounded-bl-none text-sm">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <ImageIcon className="h-3 w-3" />
                          <span>Tool Result Image</span>
                        </div>
                        <div className="relative group cursor-pointer" onClick={() => openImageModal(image.src, image.alt)}>
                          <img
                            src={image.src}
                            alt={image.alt}
                            className="max-h-80 w-auto rounded border border-border object-contain transition-transform group-hover:scale-[1.02]"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded border border-border flex items-center justify-center">
                            <ZoomIn className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 px-1">
                      <span>{timestampStr}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            
            {/* Render tool result videos as separate message bubbles */}
            {toolResultVideos.map((video, videoIndex) => (
              <div key={`${msgKey}-video-${videoIndex}`} className="w-full mt-2">
                <div className="flex items-end w-full justify-start">
                  <VideoIcon className="h-7 w-7 mr-2 mb-1 text-muted-foreground self-start flex-shrink-0" />
                  <div className="flex flex-col items-start">
                    <div className="p-3 rounded-xl shadow-sm max-w-[75%] bg-card text-card-foreground border border-border rounded-bl-none text-sm overflow-hidden">
                      <div className="flex flex-col gap-2 min-w-0">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <VideoIcon className="h-3 w-3" />
                          <span>Tool Result Video</span>
                        </div>
                        <div className="flex flex-col gap-2 p-2 rounded border border-border bg-muted/30 min-w-0">
                          <video
                            controls
                            src={video.src}
                            className="w-full max-h-[360px] rounded-lg bg-black"
                            preload="metadata"
                          />
                          {(video.filename || video.mimeType) && (
                            <div className="flex flex-col text-xs text-muted-foreground">
                              {video.filename && <span className="truncate">{video.filename}</span>}
                              {video.mimeType && <span className="opacity-70">{video.mimeType}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 px-1">
                      <span>{timestampStr}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Render tool result audio as separate message bubbles */}
            {toolResultAudios.map((audio, audioIndex) => (
              <div key={`${msgKey}-audio-${audioIndex}`} className="w-full mt-2">
                <div className="flex items-end w-full justify-start">
                  <Volume2 className="h-7 w-7 mr-2 mb-1 text-muted-foreground self-start flex-shrink-0" />
                  <div className="flex flex-col items-start">
                    <div className="p-3 rounded-xl shadow-sm max-w-[75%] bg-card text-card-foreground border border-border rounded-bl-none text-sm overflow-hidden">
                      <div className="flex flex-col gap-2 min-w-0">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Volume2 className="h-3 w-3" />
                          <span>Tool Result Audio</span>
                        </div>
                        <div className="flex flex-col gap-2 p-2 rounded border border-border bg-muted/30 min-w-0 audio-controls-container">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileAudio className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <audio 
                              controls 
                              src={audio.src} 
                              className="flex-1 min-w-0"
                            />
                          </div>
                          {audio.filename && (
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs text-muted-foreground truncate">
                                {audio.filename}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 px-1">
                      <span>{timestampStr}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {errorAnchoredHere && (
              <div className="mt-2 ml-12 mr-4">{/* indent to align under bubbles */}
                <ErrorBanner error={activeError!} onDismiss={onDismissError || (() => {})} />
              </div>
            )}
          </div>
        );
      })}

      {/* Render pending approval as inline message */}
      {pendingApproval && onApprovalApprove && onApprovalDeny && (
        <div className="w-full" data-role="approval">
          <div className="grid w-full grid-cols-[auto_1fr] gap-x-2 items-start">
            <Bot className="h-7 w-7 mt-1 text-muted-foreground col-start-1 flex-shrink-0" />
            <div className="flex flex-col group w-full col-start-2 justify-self-start items-start min-w-0">
              <div className="p-3 rounded-xl shadow-sm w-full max-w-[90%] bg-card text-card-foreground border border-border rounded-bl-none text-base min-w-0">
                <InlineApprovalCard
                  approval={pendingApproval}
                  onApprove={onApprovalApprove}
                  onDeny={onApprovalDeny}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <div key="end-anchor" ref={endRef} className="h-px" />
      
      {/* Image Modal */}
      {imageModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="relative max-w-[90vw] max-h-[90vh] bg-background rounded-lg shadow-2xl border border-border">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-lg font-semibold">Tool Result Image</h3>
              <button
                onClick={closeImageModal}
                className="p-2 hover:bg-muted rounded-md transition-colors"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            {/* Image Container */}
            <div className="p-4 flex items-center justify-center">
              <img
                src={imageModal.src}
                alt={imageModal.alt}
                className="max-w-full max-h-[70vh] object-contain rounded"
              />
            </div>
            
            {/* Footer */}
            <div className="p-4 border-t border-border text-sm text-muted-foreground">
              <p>{imageModal.alt}</p>
            </div>
          </div>
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
    new Set(
      resolved
        .filter(ref => ref.resourceUri)
        .map(ref => ref.resourceUri!)
    )
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

  // Clean up extra whitespace and newlines
  cleanedText = cleanedText
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s{2,}/g, ' ')
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
  const { cleanedText, uris } = useMemo(() => extractResourceData(text, resourceSet), [text, resourceSet]);
  const resourceStates = useResourceContent(uris);
  const hasText = cleanedText.length > 0;

  return (
    <div className="space-y-3">
      {hasText && (
        <div className="relative">
          {isUser ? (
            <p className="text-base whitespace-pre-line break-normal">{cleanedText}</p>
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
        <div key={key} className="flex items-center gap-2 rounded-lg border border-border bg-background/50 p-2">
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
        <div key={key} className="flex flex-col gap-2 rounded-lg border border-border bg-background/50 p-3">
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
        <div key={key} className="flex items-center gap-3 rounded-lg border border-border bg-background/60 p-2">
          <File className="h-4 w-4 text-muted-foreground" />
          <div className="flex flex-1 flex-col">
            <span className="text-sm font-medium text-foreground">
              {item.filename || 'Resource file'}
            </span>
            {item.mimeType && (
              <span className="text-[11px] text-muted-foreground">{item.mimeType}</span>
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
