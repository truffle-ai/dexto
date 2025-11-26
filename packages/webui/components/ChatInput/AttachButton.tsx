'use client';

import React from 'react';
import { Paperclip, File, FileAudio } from 'lucide-react';
import { Button } from '../ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { cn } from '@/lib/utils';

interface AttachButtonProps {
    onImageAttach: () => void;
    onPdfAttach: () => void;
    onAudioAttach: () => void;
    className?: string;
    supports?: {
        image?: boolean;
        pdf?: boolean;
        audio?: boolean;
    };
    /** Use lg breakpoint instead of md for responsive text */
    useLargeBreakpoint?: boolean;
}

export function AttachButton({
    onImageAttach,
    onPdfAttach,
    onAudioAttach,
    className,
    supports,
    useLargeBreakpoint = false,
}: AttachButtonProps) {
    const [open, setOpen] = React.useState(false);
    const imageSupported = supports?.image !== false; // default to true if unknown
    const pdfSupported = supports?.pdf !== false; // default to true if unknown
    const audioSupported = supports?.audio !== false;
    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                        'h-8 px-2 text-sm text-muted-foreground hover:text-foreground rounded-full',
                        useLargeBreakpoint ? 'lg:px-3' : 'md:px-3',
                        className
                    )}
                    aria-label="Attach File"
                >
                    <Paperclip
                        className={cn('h-3 w-3', useLargeBreakpoint ? 'lg:mr-1.5' : 'md:mr-1.5')}
                    />
                    <span className={cn('hidden', useLargeBreakpoint ? 'lg:inline' : 'md:inline')}>
                        Attach
                    </span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start">
                <DropdownMenuItem
                    onClick={() => {
                        if (!imageSupported) return;
                        onImageAttach();
                        setOpen(false);
                    }}
                    className={!imageSupported ? 'opacity-50 cursor-not-allowed' : undefined}
                    aria-disabled={!imageSupported}
                >
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="flex items-center">
                                    <Paperclip className="h-4 w-4 mr-2" /> Image
                                </div>
                            </TooltipTrigger>
                            {!imageSupported && (
                                <TooltipContent side="bottom">
                                    Unsupported for this model
                                </TooltipContent>
                            )}
                        </Tooltip>
                    </TooltipProvider>
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() => {
                        if (!pdfSupported) return;
                        onPdfAttach();
                        setOpen(false);
                    }}
                    className={!pdfSupported ? 'opacity-50 cursor-not-allowed' : undefined}
                    aria-disabled={!pdfSupported}
                >
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="flex items-center">
                                    <File className="h-4 w-4 mr-2" /> PDF
                                </div>
                            </TooltipTrigger>
                            {!pdfSupported && (
                                <TooltipContent side="bottom">
                                    Unsupported for this model
                                </TooltipContent>
                            )}
                        </Tooltip>
                    </TooltipProvider>
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() => {
                        if (!audioSupported) return;
                        onAudioAttach();
                        setOpen(false);
                    }}
                    className={!audioSupported ? 'opacity-50 cursor-not-allowed' : undefined}
                    aria-disabled={!audioSupported}
                >
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="flex items-center">
                                    <FileAudio className="h-4 w-4 mr-2" /> Audio file
                                </div>
                            </TooltipTrigger>
                            {!audioSupported && (
                                <TooltipContent side="bottom">
                                    Unsupported for this model
                                </TooltipContent>
                            )}
                        </Tooltip>
                    </TooltipProvider>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
