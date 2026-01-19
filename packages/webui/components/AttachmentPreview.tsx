import React from 'react';
import { Button } from './ui/button';
import { X, FileAudio, File } from 'lucide-react';
import type { Attachment } from '../lib/attachment-types.js';
import { formatFileSize } from '../lib/attachment-utils.js';

interface AttachmentPreviewProps {
    attachment: Attachment;
    onRemove: () => void;
}

export default function AttachmentPreview({ attachment, onRemove }: AttachmentPreviewProps) {
    if (attachment.type === 'image') {
        return (
            <div className="relative w-fit border border-border rounded-lg p-1 bg-muted/50 group">
                <img
                    src={`data:${attachment.mimeType};base64,${attachment.data}`}
                    alt={attachment.filename || 'preview'}
                    className="h-12 w-auto rounded-md max-w-[200px] object-cover"
                />
                <Button
                    variant="destructive"
                    size="icon"
                    onClick={onRemove}
                    className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-md"
                    aria-label="Remove attachment"
                >
                    <X className="h-3 w-3" />
                </Button>
            </div>
        );
    }

    // File attachment (PDF, audio, etc.)
    if (attachment.mimeType.startsWith('audio')) {
        return (
            <div className="relative border border-border rounded-lg p-2 bg-muted/50 flex items-center gap-2 group min-w-[200px]">
                <FileAudio className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">
                        {attachment.filename || 'audio file'}
                    </div>
                    <audio
                        controls
                        src={`data:${attachment.mimeType};base64,${attachment.data}`}
                        className="h-8 w-full mt-1"
                    />
                    <div className="text-xs text-muted-foreground mt-1">
                        {formatFileSize(attachment.size)}
                    </div>
                </div>
                <Button
                    variant="destructive"
                    size="icon"
                    onClick={onRemove}
                    className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-md flex-shrink-0"
                    aria-label="Remove attachment"
                >
                    <X className="h-3 w-3" />
                </Button>
            </div>
        );
    }

    // Other files (PDF, text, etc.)
    return (
        <div className="relative border border-border rounded-lg p-2 bg-muted/50 flex items-center gap-2 group">
            <File className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <div className="flex flex-col min-w-0">
                <span className="text-xs font-medium truncate max-w-[160px]">
                    {attachment.filename || 'attachment'}
                </span>
                <span className="text-xs text-muted-foreground">
                    {formatFileSize(attachment.size)}
                </span>
            </div>
            <Button
                variant="destructive"
                size="icon"
                onClick={onRemove}
                className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-md"
                aria-label="Remove attachment"
            >
                <X className="h-3 w-3" />
            </Button>
        </div>
    );
}
