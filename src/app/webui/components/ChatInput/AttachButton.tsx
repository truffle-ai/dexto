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

interface AttachButtonProps {
  onImageAttach: () => void;
  onPdfAttach: () => void;
  onAudioAttach: () => void;
  className?: string;
}

export function AttachButton({ 
  onImageAttach, 
  onPdfAttach, 
  onAudioAttach, 
  className 
}: AttachButtonProps) {
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
        <DropdownMenuItem onClick={onPdfAttach}>
          <File className="h-4 w-4 mr-2" /> PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAudioAttach}>
          <FileAudio className="h-4 w-4 mr-2" /> Audio file
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}