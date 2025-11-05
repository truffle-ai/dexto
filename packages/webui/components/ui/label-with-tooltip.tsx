'use client';

import React from 'react';
import { Label } from './label';
import { HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

interface LabelWithTooltipProps {
    htmlFor: string;
    children: React.ReactNode;
    tooltip?: string;
    className?: string;
}

export function LabelWithTooltip({ htmlFor, children, tooltip, className }: LabelWithTooltipProps) {
    return (
        <div className="flex items-center gap-1.5 mb-2">
            <Label htmlFor={htmlFor} className={className}>
                {children}
            </Label>
            {tooltip && (
                <TooltipProvider delayDuration={200}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground transition-colors"
                                aria-label="More information"
                            >
                                <HelpCircle className="h-3.5 w-3.5" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                            <p className="text-sm">{tooltip}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}
        </div>
    );
}
