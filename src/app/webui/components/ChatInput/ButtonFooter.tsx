'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface ButtonFooterProps {
  leftButtons?: React.ReactNode;
  rightButtons?: React.ReactNode;
  className?: string;
}

export function ButtonFooter({ leftButtons, rightButtons, className }: ButtonFooterProps) {
  return (
    <div className={cn(
      "absolute bottom-0 left-0 right-0",
      "flex items-end justify-between",
      "p-2",
      "pointer-events-none", // Allow clicking through to text area
      className
    )}>
      {/* Left side buttons (Attach, Record, etc.) */}
      <div className="flex items-center gap-2 pointer-events-auto">
        {leftButtons}
      </div>
      
      {/* Right side buttons (Send) */}
      <div className="flex items-center gap-2 pointer-events-auto">
        {rightButtons}
      </div>
    </div>
  );
}