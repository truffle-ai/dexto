'use client';

import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Copy, X } from 'lucide-react';
import { ErrorMessage } from './hooks/useChat';

interface ErrorBannerProps {
  error: ErrorMessage;
  onDismiss: () => void;
}

export default function ErrorBanner({ error, onDismiss }: ErrorBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(error.message);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = error.message;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  return (
    <div className="w-full rounded-lg p-4 mb-4 border shadow-sm bg-destructive/10 border-destructive/40">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-destructive">
                Error
              </h3>
              {error.context && (
                <span className="text-xs bg-destructive/15 text-destructive px-2 py-0.5 rounded-full">
                  {error.context}
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1 hover:bg-destructive/15 rounded text-destructive"
                title={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
              
              <button
                onClick={copyToClipboard}
                className="p-1 hover:bg-destructive/15 rounded text-destructive"
                title="Copy error"
              >
                <Copy className="h-4 w-4" />
              </button>
              
              <button
                onClick={onDismiss}
                className="p-1 hover:bg-destructive/15 rounded text-destructive"
                title="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          
          {isExpanded && (
            <div className="mt-3">
              <pre className="text-xs text-destructive bg-destructive/10 p-3 rounded border border-destructive/30 whitespace-pre-wrap overflow-auto max-h-60">
                {error.message}
              </pre>
            </div>
          )}
        </div>
      </div>
      
      {copySuccess && (
        <div className="mt-2 text-xs text-foreground">
          ✓ Copied to clipboard
        </div>
      )}
    </div>
  );
}
