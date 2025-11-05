'use client';

import React from 'react';
import { Mic, StopCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

interface RecordButtonProps {
    isRecording: boolean;
    onToggleRecording: () => void;
    className?: string;
    disabled?: boolean;
}

export function RecordButton({
    isRecording,
    onToggleRecording,
    className,
    disabled,
}: RecordButtonProps) {
    const btn = (
        <Button
            variant="ghost"
            size="sm"
            onClick={() => {
                if (!disabled) onToggleRecording();
            }}
            className={`h-8 px-2 md:px-3 text-sm rounded-full ${disabled ? 'opacity-50 cursor-not-allowed' : 'text-muted-foreground hover:text-foreground'} ${className || ''}`}
            aria-label={isRecording ? 'Stop recording' : 'Record audio'}
            aria-disabled={disabled ? true : undefined}
        >
            {isRecording ? (
                <StopCircle className="h-3 w-3 md:mr-1.5 text-red-500" />
            ) : (
                <Mic className="h-3 w-3 md:mr-1.5" />
            )}
            <span className="hidden md:inline">{isRecording ? 'Stop' : 'Record'}</span>
        </Button>
    );
    return disabled ? (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>{btn}</TooltipTrigger>
                <TooltipContent side="bottom">Unsupported for this model</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    ) : (
        btn
    );
}
