'use client';

import React from 'react';
import { Clock, CheckCircle, XCircle, History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface ExecutionHistoryItem {
  id: string;
  toolName: string;
  timestamp: Date;
  success: boolean;
  duration?: number;
}

interface ExecutionHistoryProps {
  history: ExecutionHistoryItem[];
}

export function ExecutionHistory({ history }: ExecutionHistoryProps) {
  if (history.length === 0) {
    return null;
  }

  const successCount = history.filter((h) => h.success).length;
  const failureCount = history.filter((h) => !h.success).length;

  return (
    <div className="border-t border-border pt-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Execution History</h3>
          <Badge variant="secondary" className="text-xs">
            {history.length}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <CheckCircle className="h-3 w-3 text-green-500" />
            <span>{successCount}</span>
          </div>
          <div className="flex items-center gap-1">
            <XCircle className="h-3 w-3 text-red-500" />
            <span>{failureCount}</span>
          </div>
        </div>
      </div>

      <ScrollArea className="h-32">
        <div className="space-y-2">
          {history.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {item.success ? (
                  <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
                ) : (
                  <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
                )}
                <span className="text-sm font-medium truncate">{item.toolName}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {item.duration && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {item.duration}ms
                  </span>
                )}
                <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
