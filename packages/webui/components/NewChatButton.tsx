'use client';

import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

type Props = {
    onClick: () => void;
    className?: string;
    variant?: 'outline' | 'ghost';
    side?: 'top' | 'right' | 'bottom' | 'left';
};

export function NewChatButton({ onClick, className, variant = 'outline', side = 'bottom' }: Props) {
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={variant}
                        size="sm"
                        onClick={onClick}
                        className={['h-8 w-8 p-0', className].filter(Boolean).join(' ')}
                        aria-label="New chat"
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent side={side}>New Chat (⌘K)</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

export default NewChatButton;
