'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface ChatInputContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function ChatInputContainer({ children, className }: ChatInputContainerProps) {
  return (
    <div className={cn(
      "relative",
      "w-full", 
      "max-h-[max(35svh,5rem)]", // ChatGPT's responsive height
      "border-2 border-border/50",
      "bg-background/50 backdrop-blur-sm",
      "rounded-3xl shadow-sm",
      "transition-all duration-200",
      className
    )}>
      {children}
    </div>
  );
}
