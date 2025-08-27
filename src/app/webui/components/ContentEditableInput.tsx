'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface ContentEditableInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  placeholder?: string;
  className?: string;
}

export default function ContentEditableInput({
  value,
  onChange,
  onKeyDown,
  onPaste: onPasteCallback,
  placeholder = "Ask Dexto anything...",
  className
}: ContentEditableInputProps) {
  const editableRef = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);
  
  // Update content when value prop changes (controlled component behavior)
  useEffect(() => {
    if (editableRef.current && editableRef.current.textContent !== value) {
      if (value === '') {
        // Show placeholder by clearing content
        editableRef.current.innerHTML = '';
        editableRef.current.setAttribute('data-empty', 'true');
      } else {
        editableRef.current.textContent = value;
        editableRef.current.removeAttribute('data-empty');
        // Move cursor to end
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(editableRef.current);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }, [value]);

  const handleInput = useCallback(() => {
    if (editableRef.current && !isComposing.current) {
      const text = editableRef.current.textContent || '';
      onChange(text);
      
      // Force placeholder to show when empty
      if (!text.trim()) {
        editableRef.current.innerHTML = '';
        editableRef.current.setAttribute('data-empty', 'true');
      } else {
        editableRef.current.removeAttribute('data-empty');
      }
    }
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Prevent default Enter behavior (creates new div/p)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onKeyDown?.(e);
      return;
    }
    
    // Allow Shift+Enter for new lines
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertLineBreak', false);
      handleInput();
      return;
    }
    
    onKeyDown?.(e);
  }, [onKeyDown, handleInput]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    // Call custom paste handler if provided
    if (onPasteCallback) {
      onPasteCallback(e);
      // If default prevented by custom handler, don't proceed
      if (e.defaultPrevented) {
        return;
      }
    }
    
    // Default paste behavior: plain text only
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    handleInput();
  }, [handleInput, onPasteCallback]);

  const handleCompositionStart = () => {
    isComposing.current = true;
  };

  const handleCompositionEnd = () => {
    isComposing.current = false;
    handleInput();
  };

  return (
    <div className="relative">
      <div
        ref={editableRef}
        contentEditable
        suppressContentEditableWarning
        className={cn(
          "min-h-[56px] max-h-[200px] overflow-y-auto",
          "pl-12 pr-24 py-4",
          "text-lg leading-7",
          "border-2 border-border/50 focus:border-primary/50",
          "transition-all duration-200",
          "bg-background/50 backdrop-blur-sm",
          "rounded-full",
          "shadow-sm",
          "outline-none",
          className
        )}
        data-placeholder={placeholder}
        data-empty={value === '' ? 'true' : undefined}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        spellCheck="true"
      />
    </div>
  );
}