import React from 'react';
import { cn } from '@/lib/utils';

interface ButtonFooterProps {
    leftButtons?: React.ReactNode;
    rightButtons?: React.ReactNode;
    className?: string;
}

export function ButtonFooter({ leftButtons, rightButtons, className }: ButtonFooterProps) {
    return (
        <div
            className={cn(
                // Normal flow footer row
                'flex items-center justify-between',
                // Fixed footer height with safe area padding for mobile
                'h-12 px-3 pr-4',
                // No visual separator; seamless with editor area
                // Ensure interactions work normally
                className
            )}
        >
            {/* Left side buttons (Attach, Record, etc.) */}
            <div className="flex items-center gap-2">{leftButtons}</div>

            {/* Right side buttons (Send) */}
            <div className="flex items-center gap-2">{rightButtons}</div>
        </div>
    );
}
