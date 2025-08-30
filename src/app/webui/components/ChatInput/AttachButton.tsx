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

interface AttachButtonProps {
  onImageAttach: () => void;
  onPdfAttach: () => void;
  onAudioAttach: () => void;
  className?: string;
  supports?: {
    pdf?: boolean;
    audio?: boolean;
  };
}

export function AttachButton({ 
  onImageAttach, 
  onPdfAttach, 
  onAudioAttach, 
  className,
  supports,
}: AttachButtonProps) {
  const pdfSupported = supports?.pdf !== false; // default to true if unknown
  const audioSupported = supports?.audio !== false;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-8 px-3 text-sm text-muted-foreground hover:text-foreground rounded-full ${className || ''}`}
          aria-label="Attach File"
        >
          <Paperclip className="h-3 w-3 mr-1.5" />
          Attach
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuItem onClick={onImageAttach}>
          <Paperclip className="h-4 w-4 mr-2" /> Image
        </DropdownMenuItem>
        <DropdownMenuItem 
          onSelect={(e) => { if (!pdfSupported) e.preventDefault(); }}
          onClick={pdfSupported ? onPdfAttach : undefined}
          className={!pdfSupported ? 'opacity-50 cursor-not-allowed' : undefined}
        >
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center">
                  <File className="h-4 w-4 mr-2" /> PDF
                </div>
              </TooltipTrigger>
              {!pdfSupported && <TooltipContent side="bottom">Unsupported for this model</TooltipContent>}
            </Tooltip>
          </TooltipProvider>
        </DropdownMenuItem>
        <DropdownMenuItem 
          onSelect={(e) => { if (!audioSupported) e.preventDefault(); }}
          onClick={audioSupported ? onAudioAttach : undefined}
          className={!audioSupported ? 'opacity-50 cursor-not-allowed' : undefined}
        >
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center">
                  <FileAudio className="h-4 w-4 mr-2" /> Audio file
                </div>
              </TooltipTrigger>
              {!audioSupported && <TooltipContent side="bottom">Unsupported for this model</TooltipContent>}
            </Tooltip>
          </TooltipProvider>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
