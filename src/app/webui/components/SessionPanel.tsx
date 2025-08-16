'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { 
  MessageSquare, 
  Plus, 
  Trash2, 
  Calendar, 
  Clock, 
  Hash,
  AlertTriangle,
  RefreshCw,
  MoreHorizontal
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from './ui/alert';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';

interface Session {
  id: string;
  createdAt: string | null;
  lastActivity: string | null;
  messageCount: number;
}

interface SessionPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentSessionId?: string | null;
  onSessionChange: (sessionId: string) => void;
  returnToWelcome: () => void;
  variant?: 'inline' | 'modal';
}

export default function SessionPanel({ 
  isOpen, 
  onClose, 
  currentSessionId,
  onSessionChange,
  returnToWelcome,
  variant = 'modal' 
}: SessionPanelProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNewSessionOpen, setNewSessionOpen] = useState(false);
  const [newSessionId, setNewSessionId] = useState('');
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  // Conversation management states
  const [isDeleteConversationDialogOpen, setDeleteConversationDialogOpen] = useState(false);
  const [selectedSessionForAction, setSelectedSessionForAction] = useState<string | null>(null);
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/sessions');
      if (!response.ok) throw new Error('Failed to fetch sessions');
      const data = await response.json();
      setSessions(data.sessions || []);
    } catch (err) {
      console.error('Error fetching sessions:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchSessions();
    }
  }, [isOpen, fetchSessions]);

  // Listen for message events to refresh session counts
  useEffect(() => {
    const handleMessage = () => {
      // Refresh sessions when a message is sent to update message counts
      if (isOpen) {
        fetchSessions();
      }
    };

    const handleResponse = () => {
      // Refresh sessions when a response is received to update message counts
      if (isOpen) {
        fetchSessions();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('dexto:message', handleMessage);
      window.addEventListener('dexto:response', handleResponse);
      
      return () => {
        window.removeEventListener('dexto:message', handleMessage);
        window.removeEventListener('dexto:response', handleResponse);
      };
    }
  }, [isOpen, fetchSessions]);

  const handleCreateSession = async () => {
    // Allow empty session ID for auto-generation
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: newSessionId.trim() || undefined }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create session');
      }
      
      const data = await response.json();
      setSessions(prev => [...prev, data.session]);
      setNewSessionId('');
      setNewSessionOpen(false);
      onSessionChange(data.session.id);
    } catch (err) {
      console.error('Error creating session:', err);
      setError(err instanceof Error ? err.message : 'Failed to create session');
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    setDeletingSessionId(sessionId);
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete session');
      }
      
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      
      // If we deleted the current session, trigger a page reload to return to welcome state
      if (currentSessionId === sessionId) {
        returnToWelcome();
      }
    } catch (err) {
      console.error('Error deleting session:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete session');
    } finally {
      setDeletingSessionId(null);
    }
  };


  const handleDeleteConversation = async () => {
    if (!selectedSessionForAction) return;
    
    setIsDeletingConversation(true);
    try {
      const response = await fetch(`/api/sessions/${selectedSessionForAction}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to delete conversation');
      }

      // Remove session from local state
      setSessions(prev => prev.filter(s => s.id !== selectedSessionForAction));
      
      // If we deleted the current session, trigger a page reload to return to welcome state
      if (currentSessionId === selectedSessionForAction) {
        returnToWelcome();
      }
      
      setDeleteConversationDialogOpen(false);
      setSelectedSessionForAction(null);
    } catch (error) {
      console.error('Error deleting conversation:', error);
      setError(error instanceof Error ? error.message : 'Failed to delete conversation');
    } finally {
      setIsDeletingConversation(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatRelativeTime = (dateString: string | null) => {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const content = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/50">
        <div className="flex items-center space-x-2">
          <MessageSquare className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Sessions</h2>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchSessions}
            disabled={loading}
            className="h-8 w-8 p-0"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNewSessionOpen(true)}
            className="h-8"
          >
            <Plus className="h-4 w-4 mr-1" />
            New Session
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Sessions List */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No active sessions</p>
              <p className="text-sm">Create a new session to get started</p>
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={cn(
                  "group p-3 rounded-lg border border-border/50 bg-card hover:bg-muted/50 transition-all cursor-pointer",
                  currentSessionId === session.id && "ring-2 ring-primary bg-primary/5"
                )}
                onClick={() => onSessionChange(session.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-2">
                      <h3 className="font-medium text-sm truncate">
                        {session.id}
                      </h3>
                      {currentSessionId === session.id && (
                        <Badge variant="secondary" className="text-xs">
                          Active
                        </Badge>
                      )}
                    </div>
                    
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex items-center space-x-4">
                        <div className="flex items-center space-x-1">
                          <Hash className="h-3 w-3" />
                          <span>{session.messageCount} messages</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Clock className="h-3 w-3" />
                          <span>{formatRelativeTime(session.lastActivity)}</span>
                        </div>
                      </div>
                      
                      {session.createdAt && (
                        <div className="flex items-center space-x-1">
                          <Calendar className="h-3 w-3" />
                          <span>Created {formatDate(session.createdAt)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Session Actions */}
                  <div className="flex items-center space-x-1">
                    {/* Conversation Actions - Direct Buttons */}
                    {session.messageCount > 0 && (
                      <>
                        {/* Delete Conversation Button */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSessionForAction(session.id);
                            setDeleteConversationDialogOpen(true);
                          }}
                          className="h-8 w-8 p-0"
                          title="Delete Conversation"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                    
                    {/* Delete Session Button */}
                    {session.messageCount === 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSession(session.id);
                        }}
                        disabled={deletingSessionId === session.id}
                        className="h-8 w-8 p-0"
                        title="Delete Session"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* New Session Dialog */}
      <Dialog open={isNewSessionOpen} onOpenChange={setNewSessionOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Session</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sessionId">Session ID</Label>
              <Input
                id="sessionId"
                value={newSessionId}
                onChange={(e) => setNewSessionId(e.target.value)}
                placeholder="e.g., user-123, project-alpha"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to auto-generate a unique ID
              </p>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewSessionOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateSession}>
              Create Session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Delete Conversation Confirmation Dialog */}
      <Dialog open={isDeleteConversationDialogOpen} onOpenChange={setDeleteConversationDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              <span>Delete Conversation</span>
            </DialogTitle>
            <DialogDescription>
              This will permanently delete this conversation and all its messages. This action cannot be undone.
              {selectedSessionForAction && (
                <span className="block mt-2 font-medium">
                  Session: <span className="font-mono">{selectedSessionForAction}</span>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConversationDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={handleDeleteConversation}
              disabled={isDeletingConversation}
              className="flex items-center space-x-2"
            >
              <Trash2 className="h-4 w-4" />
              <span>{isDeletingConversation ? 'Deleting...' : 'Delete Conversation'}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  if (variant === 'inline') {
    return <div className="h-full">{content}</div>;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg h-[600px] flex flex-col p-0">
        {content}
      </DialogContent>
    </Dialog>
  );
} 