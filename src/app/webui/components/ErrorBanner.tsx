'use client';

import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Copy, X } from 'lucide-react';
import { cn } from "@/lib/utils";
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
    <div className="w-full bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-red-800">
                Error
              </h3>
              {error.context && (
                <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                  {error.context}
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1 hover:bg-red-100 rounded text-red-600"
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
                className="p-1 hover:bg-red-100 rounded text-red-600"
                title="Copy error"
              >
                <Copy className="h-4 w-4" />
              </button>
              
              <button
                onClick={onDismiss}
                className="p-1 hover:bg-red-100 rounded text-red-600"
                title="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          
          {isExpanded && (
            <div className="mt-3">
              <pre className="text-xs text-red-700 bg-red-100 p-3 rounded border whitespace-pre-wrap overflow-auto max-h-60">
                {error.message}
              </pre>
            </div>
          )}
        </div>
      </div>
      
      {copySuccess && (
        <div className="mt-2 text-xs text-green-600">
          ✓ Copied to clipboard
        </div>
      )}
    </div>
  );
}