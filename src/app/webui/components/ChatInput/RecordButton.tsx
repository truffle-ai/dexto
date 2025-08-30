'use client';

import React from 'react';
import { Mic, StopCircle } from 'lucide-react';
import { Button } from '../ui/button';

interface RecordButtonProps {
  isRecording: boolean;
  onToggleRecording: () => void;
  className?: string;
}

export function RecordButton({ isRecording, onToggleRecording, className }: RecordButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onToggleRecording}
      className={`h-8 px-3 text-sm text-muted-foreground hover:text-foreground rounded-full ${className || ''}`}
      aria-label={isRecording ? 'Stop recording' : 'Record audio'}
    >
      {isRecording ? <StopCircle className="h-3 w-3 mr-1.5 text-red-500" /> : <Mic className="h-3 w-3 mr-1.5" />}
      {isRecording ? 'Stop' : 'Record'}
    </Button>
  );
}