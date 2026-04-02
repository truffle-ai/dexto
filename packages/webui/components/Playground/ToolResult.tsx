import React from 'react';
import { CheckCircle, XCircle, Copy, Download, File, FileAudio, FileVideo } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ToolResult as ToolResultType } from '@dexto/core';

interface ToolResultProps {
    result: ToolResultType;
    toolName: string;
    onCopyResult?: () => void;
}

type MediaResultItem =
    | {
          kind: 'image';
          src: string;
          mimeType?: string;
          filename?: string;
      }
    | {
          kind: 'audio';
          src: string;
          mimeType: string;
          filename?: string;
      }
    | {
          kind: 'video';
          src: string;
          mimeType: string;
          filename?: string;
      }
    | {
          kind: 'file';
          src: string;
          mimeType: string;
          filename?: string;
      };

function toDataUrl(base64: string, mimeType: string): string {
    return `data:${mimeType};base64,${base64}`;
}

function extractMediaItems(data: unknown): MediaResultItem[] {
    if (!data || typeof data !== 'object') {
        return [];
    }

    const obj = data as Record<string, unknown>;

    if (
        typeof obj.image === 'string' &&
        typeof obj.mimeType === 'string' &&
        obj.mimeType.startsWith('image/')
    ) {
        return [
            {
                kind: 'image',
                src: toDataUrl(obj.image, obj.mimeType),
                mimeType: obj.mimeType,
                filename: typeof obj.filename === 'string' ? obj.filename : undefined,
            },
        ];
    }

    if (typeof obj.data === 'string' && typeof obj.mimeType === 'string') {
        const src = toDataUrl(obj.data, obj.mimeType);
        if (obj.mimeType.startsWith('audio/')) {
            return [
                {
                    kind: 'audio',
                    src,
                    mimeType: obj.mimeType,
                    filename: typeof obj.filename === 'string' ? obj.filename : undefined,
                },
            ];
        }
        if (obj.mimeType.startsWith('video/')) {
            return [
                {
                    kind: 'video',
                    src,
                    mimeType: obj.mimeType,
                    filename: typeof obj.filename === 'string' ? obj.filename : undefined,
                },
            ];
        }
        return [
            {
                kind: 'file',
                src,
                mimeType: obj.mimeType,
                filename: typeof obj.filename === 'string' ? obj.filename : undefined,
            },
        ];
    }

    if (Array.isArray(obj.content)) {
        return obj.content.flatMap((item): MediaResultItem[] => {
            if (!item || typeof item !== 'object') {
                return [];
            }

            const mimeType = typeof item.mimeType === 'string' ? item.mimeType : undefined;
            const filename = typeof item.filename === 'string' ? item.filename : undefined;
            const base64 =
                typeof item.data === 'string'
                    ? item.data
                    : typeof item.blob === 'string'
                      ? item.blob
                      : undefined;

            if (item.type === 'image' && base64 && mimeType) {
                return [{ kind: 'image', src: toDataUrl(base64, mimeType), mimeType, filename }];
            }

            if (item.type === 'file' && base64 && mimeType) {
                const src = toDataUrl(base64, mimeType);
                if (mimeType.startsWith('audio/')) {
                    return [{ kind: 'audio', src, mimeType, filename }];
                }
                if (mimeType.startsWith('video/')) {
                    return [{ kind: 'video', src, mimeType, filename }];
                }
                return [{ kind: 'file', src, mimeType, filename }];
            }

            return [];
        });
    }

    return [];
}

export function ToolResult({ result, toolName, onCopyResult }: ToolResultProps) {
    const renderResultContent = () => {
        const mediaItems = extractMediaItems(result.data);

        if (mediaItems.length > 0) {
            return (
                <div className="space-y-3">
                    {mediaItems.map((item, idx) => {
                        if (item.kind === 'image') {
                            return (
                                <img
                                    key={idx}
                                    src={item.src}
                                    alt={item.filename || 'Tool result'}
                                    className="my-2 max-h-96 w-auto rounded-lg border border-border shadow-sm"
                                />
                            );
                        }

                        if (item.kind === 'audio') {
                            return (
                                <div
                                    key={idx}
                                    className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3"
                                >
                                    <FileAudio className="h-5 w-5 text-muted-foreground" />
                                    <audio controls src={item.src} className="h-8 flex-1" />
                                    {item.filename && (
                                        <span className="max-w-[180px] truncate text-sm text-muted-foreground">
                                            {item.filename}
                                        </span>
                                    )}
                                </div>
                            );
                        }

                        if (item.kind === 'video') {
                            return (
                                <div
                                    key={idx}
                                    className="space-y-2 rounded-lg border border-border bg-muted/50 p-3"
                                >
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <FileVideo className="h-4 w-4" />
                                        <span>{item.filename || item.mimeType}</span>
                                    </div>
                                    <video
                                        controls
                                        src={item.src}
                                        className="w-full max-h-96 rounded-lg bg-black"
                                        preload="metadata"
                                    />
                                </div>
                            );
                        }

                        return (
                            <div
                                key={idx}
                                className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3"
                            >
                                <File className="h-5 w-5 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium">
                                        {item.filename || 'file'}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        {item.mimeType}
                                    </div>
                                </div>
                                <a
                                    href={item.src}
                                    download={item.filename || 'tool-result.bin'}
                                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                                >
                                    <Download className="h-3 w-3" />
                                    Download
                                </a>
                            </div>
                        );
                    })}
                </div>
            );
        }

        // Default result rendering
        return (
            <pre className="whitespace-pre-wrap text-sm bg-muted/50 p-3 rounded-md border border-border overflow-x-auto">
                {typeof result.data === 'object'
                    ? JSON.stringify(result.data, null, 2)
                    : String(result.data)}
            </pre>
        );
    };

    return (
        <div className="mt-6 p-4 border border-border rounded-lg bg-card shadow-sm">
            <div className="flex justify-between items-center mb-3 pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                    {result.success ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                        <XCircle className="h-5 w-5 text-red-500" />
                    )}
                    <h3 className="text-base font-semibold text-foreground">
                        {result.success ? 'Success' : 'Error'}
                    </h3>
                    <span className="text-sm text-muted-foreground">• {toolName}</span>
                </div>
                {onCopyResult && result.success && (
                    <Button variant="outline" size="sm" onClick={onCopyResult}>
                        <Copy className="h-3 w-3 mr-2" />
                        Copy Result
                    </Button>
                )}
            </div>

            {result.success ? (
                <div className="space-y-3">{renderResultContent()}</div>
            ) : (
                <div className="p-3 bg-destructive/10 rounded-md">
                    <p className="text-sm text-destructive font-semibold">Error executing tool:</p>
                    <pre className="mt-1 text-xs text-destructive whitespace-pre-wrap break-all">
                        {result.error || 'Unknown error'}
                    </pre>
                </div>
            )}
        </div>
    );
}
