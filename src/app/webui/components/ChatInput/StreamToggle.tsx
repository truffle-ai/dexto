'use client';

import React from 'react';
import { Zap } from 'lucide-react';
import { Switch } from '../ui/switch';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../ui/tooltip';

interface StreamToggleProps {
  isStreaming: boolean;
  onStreamingChange: (enabled: boolean) => void;
  className?: string;
}

export function StreamToggle({ isStreaming, onStreamingChange, className }: StreamToggleProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`flex items-center gap-1.5 cursor-pointer ${className || ''}`}>
            <Zap className={`h-3 w-3 ${isStreaming ? 'text-blue-500' : 'text-muted-foreground'}`} />
            <Switch
              checked={isStreaming}
              onCheckedChange={onStreamingChange}
              className="scale-75"
              aria-label="Toggle streaming"
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{isStreaming ? 'Streaming enabled' : 'Streaming disabled'}</p>
          <p className="text-xs opacity-75">
            {isStreaming ? 'Responses will stream in real-time' : 'Responses will arrive all at once'}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}