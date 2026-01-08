import React from 'react';
import { cn } from '@/lib/utils';

interface ChatInputContainerProps {
    children: React.ReactNode;
    className?: string;
}

export function ChatInputContainer({ children, className }: ChatInputContainerProps) {
    return (
        <div
            className={cn(
                'relative',
                'w-full',
                // Vertical layout: editor (scrollable) + footer (fixed)
                // Allow overlays (e.g., slash autocomplete) to escape the editor area
                'flex flex-col overflow-visible',
                'max-h-[max(35svh,5rem)]', // commonly used responsive height
                'border border-border/30',
                // Opaque background to prevent underlying text/blur artifacts
                'bg-background',
                'rounded-3xl',
                'shadow-lg hover:shadow-xl',
                'transition-all duration-200',
                className
            )}
        >
            {children}
        </div>
    );
}
