import React from 'react';
import { Mic, StopCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { cn } from '@/lib/utils';

interface RecordButtonProps {
    isRecording: boolean;
    onToggleRecording: () => void;
    className?: string;
    disabled?: boolean;
    /** Use lg breakpoint instead of md for responsive text */
    useLargeBreakpoint?: boolean;
}

export function RecordButton({
    isRecording,
    onToggleRecording,
    className,
    disabled,
    useLargeBreakpoint = false,
}: RecordButtonProps) {
    const btn = (
        <Button
            variant="ghost"
            size="sm"
            onClick={() => {
                if (!disabled) onToggleRecording();
            }}
            className={cn(
                'h-8 px-2 text-sm rounded-full',
                useLargeBreakpoint ? 'lg:px-3' : 'md:px-3',
                disabled
                    ? 'opacity-50 cursor-not-allowed'
                    : 'text-muted-foreground hover:text-foreground',
                className
            )}
            aria-label={isRecording ? 'Stop recording' : 'Record audio'}
            aria-disabled={disabled ? true : undefined}
        >
            {isRecording ? (
                <StopCircle
                    className={cn(
                        'h-3 w-3 text-red-500',
                        useLargeBreakpoint ? 'lg:mr-1.5' : 'md:mr-1.5'
                    )}
                />
            ) : (
                <Mic className={cn('h-3 w-3', useLargeBreakpoint ? 'lg:mr-1.5' : 'md:mr-1.5')} />
            )}
            <span className={cn('hidden', useLargeBreakpoint ? 'lg:inline' : 'md:inline')}>
                {isRecording ? 'Stop' : 'Record'}
            </span>
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
