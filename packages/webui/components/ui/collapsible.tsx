'use client';

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CollapsibleProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  errorCount?: number;
  className?: string;
}

export function Collapsible({
  title,
  children,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  errorCount = 0,
  className
}: CollapsibleProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const handleToggle = () => {
    const newOpen = !isOpen;
    if (isControlled) {
      onOpenChange?.(newOpen);
    } else {
      setUncontrolledOpen(newOpen);
    }
  };

  return (
    <div className={cn('border border-border rounded-lg overflow-hidden', className)}>
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/50 hover:bg-muted transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="font-medium">{title}</span>
          {errorCount > 0 && (
            <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-destructive text-destructive-foreground rounded-full">
              {errorCount} {errorCount === 1 ? 'error' : 'errors'}
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 transition-transform duration-200',
            isOpen && 'transform rotate-180'
          )}
        />
      </button>
      {isOpen && (
        <div className="px-4 py-4 space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}
