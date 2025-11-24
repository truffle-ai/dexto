'use client';

import React from 'react';
import { CheckCircle, XCircle, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ToolResult as ToolResultType } from '@dexto/core';

interface ToolResultProps {
    result: ToolResultType;
    toolName: string;
    onCopyResult?: () => void;
}

export function ToolResult({ result, toolName, onCopyResult }: ToolResultProps) {
    const renderResultContent = () => {
        // Check if this is an image result by examining the data structure
        const isImageResult =
            result.data &&
            typeof result.data === 'object' &&
            (Array.isArray(result.data) ||
                (typeof result.data === 'object' && Array.isArray((result.data as any).content)));

        if (isImageResult && result.data) {
            let imgSrc = '';
            let imagePart: { data?: string; mimeType?: string; type?: string } | null = null;
            let nonImageParts: any[] = [];

            if (Array.isArray(result.data)) {
                imagePart = result.data.find((part) => part && part.type === 'image');
                if (imagePart && typeof imagePart.data === 'string' && imagePart.mimeType) {
                    imgSrc = `data:${imagePart.mimeType};base64,${imagePart.data}`;
                }
            } else if (
                result.data &&
                typeof result.data === 'object' &&
                Array.isArray((result.data as any).content)
            ) {
                const partsArray = (result.data as any).content as any[];
                imagePart = partsArray.find((part) => part && part.type === 'image');
                if (imagePart && typeof imagePart.data === 'string' && imagePart.mimeType) {
                    imgSrc = `data:${imagePart.mimeType};base64,${imagePart.data}`;
                }
                nonImageParts = partsArray.filter((part) => part && part.type !== 'image');
            } else if (typeof result.data === 'string') {
                if (result.data.startsWith('data:image')) {
                    imgSrc = result.data;
                } else if (
                    result.data.startsWith('http://') ||
                    result.data.startsWith('https://')
                ) {
                    imgSrc = result.data;
                }
            }

            if (imgSrc) {
                return (
                    <img
                        src={imgSrc}
                        alt="Tool result"
                        className="my-2 max-h-96 w-auto rounded-lg border border-border shadow-sm"
                    />
                );
            } else if (nonImageParts.length > 0) {
                return (
                    <div className="space-y-3">
                        {nonImageParts.map((part, idx) => (
                            <pre
                                key={idx}
                                className="whitespace-pre-wrap text-sm bg-muted/50 p-3 rounded-md border border-border font-mono overflow-x-auto max-h-64"
                            >
                                {typeof part === 'object'
                                    ? JSON.stringify(part, null, 2)
                                    : String(part)}
                            </pre>
                        ))}
                    </div>
                );
            }
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
