'use client';

import React, { useEffect, useRef, useState } from 'react';
import { cn } from "@/lib/utils";
import { 
    Message, 
    TextPart, 
    ImagePart, 
    isToolResultError, 
    isToolResultContent, 
    isTextPart, 
    isImagePart, 
    isFilePart, 
    ErrorMessage
} from './hooks/useChat';
import ErrorBanner from './ErrorBanner';
import { User, Bot, ChevronsRight, ChevronUp, Loader2, CheckCircle, ChevronRight, Wrench, AlertTriangle, Image as ImageIcon, Info, File, FileAudio, Copy, ChevronDown, X, ZoomIn } from 'lucide-react';

interface MessageListProps {
  messages: Message[];
  activeError?: ErrorMessage | null;
  onDismissError?: () => void;
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

export default function MessageList({ messages, activeError, onDismissError }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const [manuallyExpanded, setManuallyExpanded] = useState<Record<string, boolean>>({});
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [imageModal, setImageModal] = useState<{ isOpen: boolean; src: string; alt: string }>({
    isOpen: false,
    src: '',
    alt: ''
  });

  const openImageModal = (src: string, alt: string) => {
    setImageModal({ isOpen: true, src, alt });
  };

  const closeImageModal = () => {
    setImageModal({ isOpen: false, src: '', alt: '' });
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages]);

  if (!messages || messages.length === 0) {
    return null;
  }

  return (
    <div id="message-list-container" className="flex flex-col space-y-3 px-4 py-2">
      {messages.map((msg, idx) => {
        const msgKey = msg.id ?? `msg-${idx}`;
        const isUser = msg.role === 'user';
        const isAi = msg.role === 'assistant';
        const isSystem = msg.role === 'system';

        const isLastMessage = idx === messages.length - 1;
        const isToolCall = !!(msg.toolName && msg.toolArgs);
        const isToolResult = !!(msg.toolName && msg.toolResult);
        const isToolRelated = isToolCall || isToolResult;

        const isExpanded = (isToolRelated && isLastMessage) || !!manuallyExpanded[msg.id];

        // Extract image parts from tool results for separate rendering
        const toolResultImages: Array<{ src: string; alt: string; index: number }> = [];
        if (isToolResult && msg.toolResult && isToolResultContent(msg.toolResult)) {
          msg.toolResult.content.forEach((part, index) => {
            if (isImagePart(part)) {
              const src = part.base64 && part.mimeType
                ? `data:${part.mimeType};base64,${part.base64}`
                : part.base64;
              if (src && src.startsWith('data:') && isValidDataUri(src)) {
                toolResultImages.push({
                  src,
                  alt: `Tool result image ${index + 1}`,
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
              [msg.id]: !prev[msg.id]
            }));
          }
        };

        const showAvatar = isUser || isAi;
        const AvatarComponent = isUser ? User : Bot;

        const messageContainerClass = cn(
          "flex items-end w-full",
          isUser ? "justify-end" : "justify-start",
          isSystem && "justify-center"
        );

        // Bubble styling: users and AI are speech bubbles; tools are full-width transient blocks
        const bubbleSpecificClass = cn(
          msg.role === 'tool'
            ? "w-full text-muted-foreground/70 bg-secondary border border-muted/30 rounded-md text-sm"
            : isUser
            ? "p-3 rounded-xl shadow-sm max-w-[75%] bg-primary text-primary-foreground rounded-br-none text-sm"
            : isAi
            ? "p-3 rounded-xl shadow-sm max-w-[75%] bg-card text-card-foreground border border-border rounded-bl-none text-sm"
            : isSystem
            ? "p-3 shadow-none w-full bg-transparent text-xs text-muted-foreground italic text-center border-none"
            : "",
        );

        const contentWrapperClass = "flex flex-col gap-2";
        const timestampStr = formatTimestamp(msg.createdAt);

        const errorAnchoredHere = !!(activeError && activeError.anchorMessageId === msg.id);

        return (
          <div key={msgKey} className="w-full">
            <div className={messageContainerClass}>
              {isAi && <AvatarComponent className="h-7 w-7 mr-2 mb-1 text-muted-foreground self-start flex-shrink-0" />}
              {msg.role === 'tool' && <Wrench className="h-7 w-7 p-1 mr-3 mt-1 rounded-full border border-border text-muted-foreground self-start flex-shrink-0" />}
              
              <div className={cn("flex flex-col", isUser ? "items-end" : "items-start", isSystem && "w-full items-center")}> 
              <div className={bubbleSpecificClass}>
                <div className={contentWrapperClass}>
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
                            <pre className="whitespace-pre-wrap overflow-auto bg-background/50 p-2 rounded text-xs text-muted-foreground">
                              {JSON.stringify(msg.toolArgs, null, 2)}
                            </pre>
                          </div>
                          {msg.toolResult && (
                            <div>
                              <p className="text-xs font-medium">Result:</p>
                              {isToolResultError(msg.toolResult) ? (
                                <pre className="whitespace-pre-wrap overflow-auto bg-red-100 text-red-700 p-2 rounded text-xs">
                                  {typeof msg.toolResult.error === 'object'
                                    ? JSON.stringify(msg.toolResult.error, null, 2)
                                    : String(msg.toolResult.error)}
                                </pre>
                              ) : isToolResultContent(msg.toolResult) ? (
                                msg.toolResult.content.map((part, index) => {
                                  // Skip image parts as they will be rendered separately
                                  if (isImagePart(part)) {
                                    return null;
                                  }
                                  if (isTextPart(part)) {
                                    return (
                                      <pre key={index} className="whitespace-pre-wrap overflow-auto bg-background/50 p-2 rounded text-xs text-muted-foreground my-1">
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
                                    <pre key={index} className="whitespace-pre-wrap overflow-auto bg-background/50 p-2 rounded text-xs text-muted-foreground my-1">
                                      {typeof part === 'object' ? JSON.stringify(part, null, 2) : String(part)}
                                    </pre>
                                  );
                                })
                              ) : (
                                <pre className="whitespace-pre-wrap overflow-auto bg-background/50 p-2 rounded text-xs text-muted-foreground">
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
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      )}

                      {msg.content && typeof msg.content === 'object' && !Array.isArray(msg.content) && (
                        <pre className="whitespace-pre-wrap overflow-auto bg-background/50 p-2 rounded text-xs text-muted-foreground">
                          {JSON.stringify(msg.content, null, 2)}
                        </pre>
                      )}

                      {Array.isArray(msg.content) && msg.content.map((part, partIdx) => {
                        const partKey = `${msgKey}-part-${partIdx}`;
                        if (part.type === 'text') {
                          return <p key={partKey} className="whitespace-pre-wrap">{(part as TextPart).text}</p>;
                        }
                        if (part.type === 'image' && 'base64' in part && 'mimeType' in part) {
                          const imagePart = part as ImagePart;
                          const src = `data:${imagePart.mimeType};base64,${imagePart.base64}`;
                          if (!isValidDataUri(src)) {
                            return null;
                          }
                          return (
                            <img
                              key={partKey}
                              src={src}
                              alt="attachment"
                              className="my-2 max-h-60 w-full rounded-lg border border-border object-contain"
                            />
                          );
                        }
                        if ((part as any).type === 'file' && 'data' in part && 'mimeType' in part) {
                          const filePart = part as any;
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
                         <div className="flex items-center gap-2 p-3 rounded-lg border border-border bg-muted/50">
                           <FileAudio className="h-5 w-5 text-muted-foreground" />
                           <audio 
                             controls 
                             src={`data:${msg.fileData.mimeType};base64,${msg.fileData.base64}`} 
                             className="flex-1 h-8"
                           />
                           {msg.fileData.filename && (
                             <span className="text-sm text-muted-foreground truncate max-w-[120px]">
                               {msg.fileData.filename}
                             </span>
                           )}
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
                <div className="text-xs text-muted-foreground mt-1 px-1 flex items-center gap-2">
                  <span>{timestampStr}</span>
                  {isAi && msg.tokenCount && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/50 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                      {msg.tokenCount} tokens
                    </span>
                  )}
                  {isAi && msg.model && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/30 text-xs">
                      {msg.model}
                    </span>
                  )}
                  {/* {msg.sessionId && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono bg-muted/20">
                      {msg.sessionId.slice(0, 8)}
                    </span>
                  )} */}
                </div>
              )}
              </div>
              {isUser && <AvatarComponent className="h-7 w-7 ml-2 mb-1 text-muted-foreground self-start flex-shrink-0" />}
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
