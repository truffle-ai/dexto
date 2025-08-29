'use client';

import React, { useEffect, useRef, useState } from 'react';
import { cn } from "@/lib/utils";
import { 
    Message, 
    TextPart, 
    isToolResultError, 
    isToolResultContent, 
    isTextPart, 
    isImagePart, 
    isAudioPart,
    isFilePart, 
    ErrorMessage,
    ToolResult
} from './hooks/useChat';
import ErrorBanner from './ErrorBanner';
import { User, Bot, ChevronsRight, ChevronUp, Loader2, CheckCircle, ChevronRight, Wrench, AlertTriangle, Image as ImageIcon, Info, File, FileAudio, Copy, ChevronDown, Brain, Check as CheckIcon, X, ZoomIn, Volume2 } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { MarkdownText } from './ui/markdown-text';
import { TooltipIconButton } from './ui/tooltip-icon-button';
import { CopyButton } from './ui/copy-button';
import { SpeakButton } from './ui/speak-button';

interface MessageListProps {
  messages: Message[];
  activeError?: ErrorMessage | null;
  onDismissError?: () => void;
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

// Helper to validate data URI for images to prevent XSS
function isValidDataUri(src: string): boolean {
  const dataUriRegex = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/i;
  return dataUriRegex.test(src);
}

// Helper to validate safe HTTP/HTTPS URLs for media
function isSafeHttpUrl(src: string): boolean {
  try {
    const url = new URL(src);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== 'localhost';
  } catch {
    return false;
  }
}

// Helper to check if a URL is safe for media rendering
function isSafeMediaUrl(src: string): boolean {
  return (src.startsWith('data:') && isValidDataUri(src)) || 
         src.startsWith('blob:') || 
         isSafeHttpUrl(src);
}

// Helper to check if a URL is safe for audio rendering  
function isSafeAudioUrl(src: string): boolean {
  return src.startsWith('data:audio/') || 
         src.startsWith('blob:') || 
         isSafeHttpUrl(src);
}

// Helper to resolve media source from different formats
function resolveMediaSrc(part: any): string {
  // Check for base64 data first
  if (part.base64 && part.mimeType) {
    return `data:${part.mimeType};base64,${part.base64}`;
  }
  if (typeof part.base64 === 'string') {
    return part.base64;
  }
  
  // Check for URL-based sources
  const urlSrc = part.url ?? part.image ?? part.audio;
  return typeof urlSrc === 'string' ? urlSrc : '';
}

export default function MessageList({ messages, activeError, onDismissError, outerRef }: MessageListProps) {
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

        const isLastMessage = idx === messages.length - 1;
        const isToolCall = !!(msg.toolName && msg.toolArgs);
        const isToolResult = !!(msg.toolName && msg.toolResult);
        const isToolRelated = isToolCall || isToolResult;

        const isExpanded = (isToolRelated && isLastMessage) || !!manuallyExpanded[msgKey];

        // Extract image and audio parts from tool results for separate rendering
        const toolResultImages: Array<{ src: string; alt: string; index: number }> = [];
        const toolResultAudios: Array<{ src: string; filename?: string; index: number }> = [];
        if (isToolResult && msg.toolResult && isToolResultContent(msg.toolResult)) {
          msg.toolResult.content.forEach((part, index) => {
            if (isImagePart(part)) {
              const src = resolveMediaSrc(part);
              
              if (src && isSafeMediaUrl(src)) {
                toolResultImages.push({
                  src,
                  alt: `Tool result image ${index + 1}`,
                  index
                });
              }
            } else if (isAudioPart(part)) {
              const src = resolveMediaSrc(part);
              
              if (src && isSafeAudioUrl(src)) {
                toolResultAudios.push({
                  src,
                  filename: part.filename,
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
            ? "p-3 shadow-none w-full bg-transparent text-xs text-muted-foreground italic text-center border-none"
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
                            setReasoningExpanded((prev) => ({ ...prev, [msg.id!]: !prev[msg.id!] }))
                          }
                        >
                          <Brain className="h-3.5 w-3.5" />
                          <span>AI Reasoning</span>
                          {(reasoningExpanded[msg.id!] ?? true) ? (
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
                      {(reasoningExpanded[msg.id!] ?? true) && (
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
                                  // Skip image and audio parts as they will be rendered separately
                                  if (isImagePart(part) || isAudioPart(part)) {
                                    return null;
                                  }
                                  if (isTextPart(part)) {
                                    return (
                                      <pre key={index} className="whitespace-pre-wrap break-words overflow-auto bg-background/50 p-2 rounded text-xs text-muted-foreground my-1">
                                        {part.text}
                                      </pre>
                                    );
                                  }
                                  if (isFilePart(part)) {
                                    return (
                                      <div key={index} className="my-1 flex items-center gap-2 p-2 rounded border border-border bg-muted/50">
                                        <FileAudio className="h-4 w-4 text-muted-foreground" />
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
                                    ? (isValidDataUri(msg.toolResult) ? <img src={msg.toolResult} alt="Tool result image" className="my-1 max-h-48 w-auto rounded border border-border" /> : 'Invalid image data')
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
                          {isUser ? (
                            <p className="text-base whitespace-pre-line break-normal">
                              {msg.content}
                            </p>
                          ) : (
                            <MarkdownText>{msg.content}</MarkdownText>
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
                            <div key={partKey} className="relative">
                              {isUser ? (
                                <p className="text-base whitespace-pre-line break-normal">
                                  {(part as TextPart).text}
                                </p>
                              ) : (
                                <MarkdownText>{(part as TextPart).text}</MarkdownText>
                              )}
                            </div>
                          );
                        }
                        if (isFilePart(part)) {
                          const filePart = part;
                          if (filePart.mimeType.startsWith('audio/')) {
                            const src = `data:${filePart.mimeType};base64,${filePart.data}`;
                            return (
                              <div key={partKey} className="my-2 flex items-center gap-2 p-3 rounded-lg border border-border bg-muted/50">
                                <FileAudio className="h-5 w-5 text-muted-foreground" />
                                <audio 
                                  controls 
                                  src={src} 
                                  className="flex-1 h-8"
                                />
                                {filePart.filename && (
                                  <span className="text-sm text-muted-foreground truncate max-w-[120px]">
                                    {filePart.filename}
                                  </span>
                                )}
                              </div>
                            );
                          } else {
                            // Non-audio files (PDFs, etc.)
                            return (
                              <div key={partKey} className="my-2 flex items-center gap-2 p-3 rounded-lg border border-border bg-muted/50">
                                <File className="h-5 w-5 text-muted-foreground" />
                                <span className="text-sm font-medium">
                                  {filePart.filename || `${filePart.mimeType} file`}
                                </span>
                                <span className="text-xs text-muted-foreground">
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
                      if (!isValidDataUri(src)) {
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
                      {msg.fileData.mimeType.startsWith('audio/') ? (
                         <div className="relative w-fit border border-border rounded-lg p-2 bg-muted/50 flex items-center gap-2 group">
                           <FileAudio className="h-4 w-4" />
                           <audio 
                             controls 
                             src={`data:${msg.fileData.mimeType};base64,${msg.fileData.base64}`} 
                             className="h-8"
                           />
                         </div>
                       ) : (
                         <div className="flex items-center gap-2 p-3 rounded-lg border border-border bg-muted/50">
                           <File className="h-5 w-5 text-muted-foreground" />
                           <span className="text-sm font-medium">
                             {msg.fileData.filename || `${msg.fileData.mimeType} file`}
                           </span>
                           <span className="text-xs text-muted-foreground">
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
                      <TooltipContent>
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
                      <TooltipContent>
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
