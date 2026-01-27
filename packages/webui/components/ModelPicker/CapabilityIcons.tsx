import React from 'react';
import { Lock, Eye, FileText, Mic, Brain } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../../lib/utils';
import type { ModelInfo } from './types';

interface CapabilityIconsProps {
    supportedFileTypes: ModelInfo['supportedFileTypes'];
    hasApiKey: boolean;
    showReasoning?: boolean;
    showLockIcon?: boolean;
    className?: string;
    size?: 'sm' | 'md';
}

interface CapabilityBadgeProps {
    icon: React.ReactNode;
    label: string;
    variant?: 'default' | 'warning' | 'success' | 'info';
}

function CapabilityBadge({ icon, label, variant = 'default' }: CapabilityBadgeProps) {
    const variantStyles = {
        default: 'bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground',
        warning: 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20',
        success: 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20',
        info: 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20',
    };

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div
                    className={cn(
                        'flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-200 cursor-default',
                        variantStyles[variant]
                    )}
                >
                    {icon}
                </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
                {label}
            </TooltipContent>
        </Tooltip>
    );
}

export function CapabilityIcons({
    supportedFileTypes,
    hasApiKey,
    showReasoning,
    showLockIcon = true,
    className,
    size = 'sm',
}: CapabilityIconsProps) {
    const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

    return (
        <div className={cn('flex items-center gap-1', className)}>
            {supportedFileTypes?.includes('image') && (
                <CapabilityBadge
                    icon={<Eye className={iconSize} />}
                    label="Vision / Image support"
                    variant="success"
                />
            )}

            {supportedFileTypes?.includes('pdf') && (
                <CapabilityBadge
                    icon={<FileText className={iconSize} />}
                    label="PDF support"
                    variant="info"
                />
            )}

            {supportedFileTypes?.includes('audio') && (
                <CapabilityBadge
                    icon={<Mic className={iconSize} />}
                    label="Audio support"
                    variant="info"
                />
            )}

            {showReasoning && (
                <CapabilityBadge
                    icon={<Brain className={iconSize} />}
                    label="Extended thinking"
                    variant="default"
                />
            )}

            {showLockIcon && !hasApiKey && (
                <CapabilityBadge
                    icon={<Lock className={iconSize} />}
                    label="Click to add API key"
                    variant="warning"
                />
            )}
        </div>
    );
}
