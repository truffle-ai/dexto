'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useChatContext } from './hooks/ChatContext';
import MessageList from './MessageList';
import InputArea from './InputArea';
import ConnectServerModal from './ConnectServerModal';
import ServerRegistryModal from './ServerRegistryModal';
import ServersPanel from './ServersPanel';
import SessionPanel from './SessionPanel';
import { ToolConfirmationHandler } from './ToolConfirmationHandler';
import GlobalSearchModal from './GlobalSearchModal';
import { Button } from "./ui/button";
import { Server, Download, Wrench, Keyboard, AlertTriangle, Plus, MoreHorizontal, MessageSquare, Trash2, Search, Settings, PanelLeft } from "lucide-react";
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Alert, AlertTitle, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import Link from 'next/link';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';
import { ThemeSwitch } from './ThemeSwitch';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './ui/tooltip';

export default function ChatApp() {
  const { messages, sendMessage, currentSessionId, switchSession, isWelcomeState, returnToWelcome, websocket } = useChatContext();

  const [isModalOpen, setModalOpen] = useState(false);
  const [isServerRegistryOpen, setServerRegistryOpen] = useState(false);
  const [isServersPanelOpen, setServersPanelOpen] = useState(false);
  const [isSessionsPanelOpen, setSessionsPanelOpen] = useState(false);
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [isExportOpen, setExportOpen] = useState(false);
  const [exportName, setExportName] = useState('dexto-config');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportContent, setExportContent] = useState<string>('');
  const [copySuccess, setCopySuccess] = useState(false);
  
  // Enhanced features
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Conversation management states
  const [isDeleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Welcome screen search state
  const [welcomeSearchQuery, setWelcomeSearchQuery] = useState('');

  useEffect(() => {
    if (isExportOpen) {
      // Include current session ID in config export if available
      const exportUrl = currentSessionId 
        ? `/api/config.yaml?sessionId=${currentSessionId}`
        : '/api/config.yaml';
      
      fetch(exportUrl)
        .then((res) => {
          if (!res.ok) throw new Error('Failed to fetch configuration');
          return res.text();
        })
        .then((text) => {
          setExportContent(text);
          setExportError(null);
        })
        .catch((err) => {
          console.error('Preview fetch failed:', err);
          setExportError(err instanceof Error ? err.message : 'Preview fetch failed');
        });
    } else {
      setExportContent('');
      setExportError(null);
      setCopySuccess(false);
    }
  }, [isExportOpen, currentSessionId]);

  const handleDownload = useCallback(async () => {
    try {
      const exportUrl = currentSessionId 
        ? `/api/config.yaml?sessionId=${currentSessionId}`
        : '/api/config.yaml';
      
      const res = await fetch(exportUrl);
      if (!res.ok) throw new Error('Failed to fetch configuration');
      const yamlText = await res.text();
      const blob = new Blob([yamlText], { type: 'application/x-yaml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const fileName = currentSessionId
        ? `${exportName}-${currentSessionId}.yml`
        : `${exportName}.yml`;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      setExportError(error instanceof Error ? error.message : 'Download failed');
    }
  }, [exportName, currentSessionId]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(exportContent);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      console.error('Copy failed:', error);
      setExportError('Failed to copy to clipboard');
    }
  }, [exportContent]);

  const handleSend = useCallback(async (content: string, imageData?: any, fileData?: any) => {
    setIsSendingMessage(true);
    setErrorMessage(null);
    
    try {
      await sendMessage(content, imageData, fileData);
    } catch (error) {
      console.error('Failed to send message:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to send message');
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setIsSendingMessage(false);
    }
  }, [sendMessage]);

  const handleSessionChange = useCallback((sessionId: string) => {
    switchSession(sessionId);
    setSessionsPanelOpen(false);
  }, [switchSession]);

  const handleInstallServer = useCallback(async (entry: any) => {
    try {
      const response = await fetch('/api/mcp/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId: entry.id }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to install server');
      }
      
      // Close the modal and refresh servers panel if open
      setServerRegistryOpen(false);
      if (isServersPanelOpen) {
        // Trigger a refresh of the servers panel
        window.dispatchEvent(new CustomEvent('refresh-servers'));
      }
    } catch (error) {
      console.error('Failed to install server:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to install server');
      setTimeout(() => setErrorMessage(null), 5000);
    }
  }, [isServersPanelOpen]);

  const handleDeleteConversation = useCallback(async () => {
    if (!currentSessionId) return;
    
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/sessions/${currentSessionId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete conversation');
      }
      
      setDeleteDialogOpen(false);
      returnToWelcome();
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete conversation');
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setIsDeleting(false);
    }
  }, [currentSessionId, returnToWelcome]);

  const handleWelcomeSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (welcomeSearchQuery.trim()) {
      handleSend(welcomeSearchQuery.trim());
      setWelcomeSearchQuery('');
    }
  }, [welcomeSearchQuery, handleSend]);

  const quickActions = [
    {
      title: "Help me get started",
      description: "Show me what you can do",
      action: () => handleSend("I'm new to Dexto. Can you show me your capabilities and help me understand how to work with you effectively?"),
      icon: "🚀"
    },
    {
      title: "Create Snake Game",
      description: "Build a game and open it",
      action: () => handleSend("Create a snake game in a new directory with HTML, CSS, and JavaScript, then open it in the browser for me to play."),
      icon: "🐍"
    },
    {
      title: "Connect new tools",
      description: "Browse and add MCP servers",
      action: () => setServersPanelOpen(true),
      icon: "🔧"
    },
    {
      title: "Demonstrate tools",
      description: "Show me your capabilities",
      action: () => handleSend("Pick one of your most interesting tools and demonstrate it with a practical example. Show me what it can do."),
      icon: "⚡"
    }
  ];

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + H to toggle sessions panel
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'h') {
        e.preventDefault();
        setSessionsPanelOpen(prev => !prev);
      }
      // Ctrl/Cmd + K to create new session
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'k') {
        e.preventDefault();
        // Create new session using the same logic as SessionPanel
        fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        .then(response => response.json())
        .then(data => handleSessionChange(data.session.id))
        .catch(error => {
          console.error('Error creating new session:', error);
          setErrorMessage('Failed to create new session. Please try again.');
          setTimeout(() => setErrorMessage(null), 5000);
        });
      }
      // Ctrl/Cmd + J to toggle tools/servers panel
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'j') {
        e.preventDefault();
        setServersPanelOpen(prev => !prev);
      }
      // Ctrl/Cmd + Shift + S to open search
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 's') {
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen(true);
      }
      // Ctrl/Cmd + L to open playground
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'l') {
        e.preventDefault();
        window.open('/playground', '_blank');
      }
      // Ctrl/Cmd + Shift + E to export config
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'e') {
        e.preventDefault();
        setExportOpen(true);
      }
      // Ctrl/Cmd + / to show shortcuts
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === '/') {
        e.preventDefault();
        setShowShortcuts(true);
      }
      // Escape to close panels
      if (e.key === 'Escape') {
        if (isServersPanelOpen) setServersPanelOpen(false);
        else if (isSessionsPanelOpen) setSessionsPanelOpen(false);
        else if (isServerRegistryOpen) setServerRegistryOpen(false);
        else if (isExportOpen) setExportOpen(false);
        else if (showShortcuts) setShowShortcuts(false);
        else if (isDeleteDialogOpen) setDeleteDialogOpen(false);
        else if (errorMessage) setErrorMessage(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isServersPanelOpen, isSessionsPanelOpen, isSearchOpen, isServerRegistryOpen, isExportOpen, showShortcuts, isDeleteDialogOpen, errorMessage, setSearchOpen]);

  return (
    <div className="flex h-screen bg-background">
      {/* Left Sidebar - Chat History */}
      <div className={cn(
        "shrink-0 transition-all duration-300 ease-in-out border-r border-border/50 bg-card/50 backdrop-blur-sm",
        isSessionsPanelOpen ? "w-80" : "w-0 overflow-hidden"
      )}>
        {isSessionsPanelOpen && (
          <SessionPanel
            isOpen={isSessionsPanelOpen}
            onClose={() => setSessionsPanelOpen(false)}
            currentSessionId={currentSessionId}
            onSessionChange={handleSessionChange}
            returnToWelcome={returnToWelcome}
            variant="inline"
            onSearchOpen={() => setSearchOpen(true)}
          />
        )}
      </div>

      <main className="flex-1 flex flex-col relative">
        {/* Clean Header */}
        <header className="shrink-0 border-b border-border/50 bg-background/95 backdrop-blur-xl shadow-sm">
          <div className="flex justify-between items-center px-4 py-3">
            <div className="flex items-center space-x-4">
              {/* Chat History Toggle */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setSessionsPanelOpen(!isSessionsPanelOpen)}
                    className={cn(
                      "h-8 w-8 p-0 transition-colors",
                      isSessionsPanelOpen && "bg-muted"
                    )}
                  >
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Chat History (⌘H)
                </TooltipContent>
              </Tooltip>
              
              {/* New Chat Button - Only show when panel is closed */}
              {!isSessionsPanelOpen && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => {
                        fetch('/api/sessions', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({}),
                        })
                        .then(response => response.json())
                        .then(data => handleSessionChange(data.session.id))
                        .catch(error => {
                          console.error('Error creating new session:', error);
                          setErrorMessage('Failed to create new session. Please try again.');
                          setTimeout(() => setErrorMessage(null), 5000);
                        });
                      }}
                      className="h-8 w-8 p-0"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    New Chat (⌘K)
                  </TooltipContent>
                </Tooltip>
              )}
              
              <div className="flex items-center space-x-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg border border-primary/20 bg-primary/5 text-primary-foreground shadow-sm">
                  <img src="/logo.png" alt="Dexto" className="w-5 h-5" />
                </div>
                <h1 className="text-lg font-semibold tracking-tight text-foreground">Dexto</h1>
              </div>
              
              {/* Current Session Indicator - Only show when there's an active session */}
              {currentSessionId && !isWelcomeState && (
                <div className="flex items-center space-x-2">
                  <Badge variant="secondary" className="text-xs bg-muted/50 border-border/30">
                    {currentSessionId}
                  </Badge>
                </div>
              )}
            </div>
          
            {/* Minimal Action Bar */}
            <div className="flex items-center space-x-1">
              <ThemeSwitch />
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setServersPanelOpen(!isServersPanelOpen)}
                    className={cn(
                      "h-8 px-2 text-xs transition-colors",
                      isServersPanelOpen && "bg-muted"
                    )}
                  >
                    <Server className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline ml-1.5">Tools</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Toggle tools panel (⌘J)
                </TooltipContent>
              </Tooltip>
            
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost"
                    size="sm"
                    asChild
                    className="h-8 px-2 text-xs"
                  >
                    <Link href="/playground" target="_blank">
                      <Wrench className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline ml-1.5">Playground</span>
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Open playground (⌘L)
                </TooltipContent>
              </Tooltip>
            
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setServerRegistryOpen(true)}>
                      <Server className="h-4 w-4 mr-2" />
                      Browse MCP Registry
                    </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setExportOpen(true)}>
                    <Download className="h-4 w-4 mr-2" />
                    Export Config
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowShortcuts(true)}>
                    <Keyboard className="h-4 w-4 mr-2" />
                    Shortcuts
                  </DropdownMenuItem>
                  {/* Session Management Actions - Only show when there's an active session */}
                  {currentSessionId && !isWelcomeState && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={() => setDeleteDialogOpen(true)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Conversation
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>
        
        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Error Message */}
          {errorMessage && (
            <div className="absolute top-4 right-4 z-50 bg-destructive text-destructive-foreground px-4 py-2 rounded-md shadow-lg">
              {errorMessage}
            </div>
          )}
          
          {/* Chat Content */}
          <div className="flex-1 flex flex-col">
            {isWelcomeState || messages.length === 0 ? (
              /* Modern Welcome Screen with Central Search */
              <div className="flex-1 flex items-center justify-center p-6 -mt-20">
                <div className="w-full max-w-2xl space-y-6">
                  <div className="space-y-4 text-center">
                    <div className="flex items-center justify-center w-12 h-12 mx-auto rounded-2xl bg-primary/10 text-primary shadow-sm">
                      <img src="/logo.png" alt="Dexto" className="w-6 h-6" />
                    </div>
                    <div className="space-y-2">
                      <h2 className="text-2xl font-bold font-mono tracking-tight bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                        Welcome to Dexto
                      </h2>
                      <p className="text-base text-muted-foreground max-w-md mx-auto leading-relaxed">
                        Your AI assistant with powerful tools. Ask anything or connect new capabilities.
                      </p>
                    </div>
                  </div>

                  {/* Quick Actions Grid - Compact */}
                  <div className="flex flex-wrap justify-center gap-2 max-w-2xl mx-auto">
                    {quickActions.map((action, index) => (
                      <button
                        key={index}
                        onClick={action.action}
                        className="group px-3 py-2 text-left rounded-full bg-primary/5 hover:bg-primary/10 transition-all duration-200 hover:shadow-sm hover:scale-105"
                      >
                        <div className="flex items-center space-x-1.5">
                          <span className="text-sm">{action.icon}</span>
                          <span className="font-medium text-xs text-primary group-hover:text-primary/80 transition-colors">
                            {action.title}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Central Search Bar with Full Features */}
                  <div className="max-w-2xl mx-auto">
                    <InputArea
                      onSend={handleSend}
                      isSending={isSendingMessage}
                      variant="welcome"
                    />
                  </div>
                
                  {/* Quick Tips */}
                  <div className="text-xs text-muted-foreground space-y-1 text-center">
                    <p>💡 Try <kbd className="px-1 py-0.5 bg-muted rounded text-xs">⌘K</kbd> for new chat, <kbd className="px-1 py-0.5 bg-muted rounded text-xs">⌘J</kbd> for tools, <kbd className="px-1 py-0.5 bg-muted rounded text-xs">⌘L</kbd> for playground, <kbd className="px-1 py-0.5 bg-muted rounded text-xs">⌘/</kbd> for shortcuts</p>
                  </div>
                </div>
              </div>
            ) : (
              /* Messages Area */
              <div className="flex-1 overflow-hidden">
                <div className="h-full overflow-y-auto">
                  <MessageList 
                    messages={messages}
                  />
                </div>
              </div>
            )}
            
            {/* Input Area - Only show when in chat state */}
            {!isWelcomeState && messages.length > 0 && (
              <div className="shrink-0 border-t border-border/50 bg-background/95 backdrop-blur-xl shadow-sm">
                <div className="p-4">
                  <InputArea
                    onSend={handleSend}
                    isSending={isSendingMessage}
                    variant="chat"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Servers Panel - Slide Animation */}
          <div className={cn(
            "shrink-0 transition-all duration-300 ease-in-out border-l border-border/50 bg-card/50 backdrop-blur-sm",
            isServersPanelOpen ? "w-80" : "w-0 overflow-hidden"
          )}>
            {isServersPanelOpen && (
              <ServersPanel
                isOpen={isServersPanelOpen}
                onClose={() => setServersPanelOpen(false)}
                onOpenConnectModal={() => setModalOpen(true)}
                variant="inline"
              />
            )}
          </div>
        </div>
        
        {/* Connect Server Modal */}
        <ConnectServerModal 
          isOpen={isModalOpen} 
          onClose={() => setModalOpen(false)} 
        />

        {/* Server Registry Modal */}
        <ServerRegistryModal
          isOpen={isServerRegistryOpen}
          onClose={() => setServerRegistryOpen(false)}
          onInstallServer={handleInstallServer}
        />

        {/* Export Configuration Modal */}
        <Dialog open={isExportOpen} onOpenChange={setExportOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center space-x-2">
                <Download className="h-5 w-5" />
                <span>Export Configuration</span>
              </DialogTitle>
              <DialogDescription>
                Download your tool configuration for Claude Desktop or other MCP clients
                {currentSessionId && (
                  <span className="block mt-1 text-sm text-muted-foreground">
                    Including session-specific settings for: <span className="font-mono">{currentSessionId}</span>
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="filename">File name</Label>
                <Input
                  id="filename"
                  value={exportName}
                  onChange={(e) => setExportName(e.target.value)}
                  placeholder="dexto-config"
                  className="font-mono"
                />
              </div>
              
              {exportError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Export Error</AlertTitle>
                  <AlertDescription>{exportError}</AlertDescription>
                </Alert>
              )}
              
              {exportContent && (
                <div className="space-y-2">
                  <Label>Configuration Preview</Label>
                  <Textarea
                    value={exportContent}
                    readOnly
                    className="h-32 font-mono text-xs bg-muted/30"
                  />
                </div>
              )}
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={handleCopy} className="flex items-center space-x-2">
                <span>{copySuccess ? 'Copied!' : 'Copy'}</span>
              </Button>
              <Button onClick={handleDownload} className="flex items-center space-x-2">
                <Download className="h-4 w-4" />
                <span>Download</span>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


        {/* Delete Conversation Confirmation Modal */}
        <Dialog open={isDeleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center space-x-2">
                <Trash2 className="h-5 w-5 text-destructive" />
                <span>Delete Conversation</span>
              </DialogTitle>
              <DialogDescription>
                This will permanently delete this conversation and all its messages. This action cannot be undone.
                {currentSessionId && (
                  <span className="block mt-2 font-medium">
                    Session: <span className="font-mono">{currentSessionId}</span>
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                variant="destructive"
                onClick={handleDeleteConversation}
                disabled={isDeleting}
                className="flex items-center space-x-2"
              >
                <Trash2 className="h-4 w-4" />
                <span>{isDeleting ? 'Deleting...' : 'Delete Conversation'}</span>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Shortcuts Modal */}
        <Dialog open={showShortcuts} onOpenChange={setShowShortcuts}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center space-x-2">
                <Keyboard className="h-5 w-5" />
                <span>Keyboard Shortcuts</span>
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-3">
              {[
                { key: '⌘H', desc: 'Toggle chat history panel' },
                { key: '⌘K', desc: 'Create new chat' },
                { key: '⌘J', desc: 'Toggle tools panel' },
                { key: '⌘⇧S', desc: 'Search conversations' },
                { key: '⌘L', desc: 'Open playground' },
                { key: '⌘⇧E', desc: 'Export config' },
                { key: '⌘/', desc: 'Show shortcuts' },
                { key: 'Esc', desc: 'Close panels' },
              ].map((shortcut, index) => (
                <div key={index} className="flex justify-between items-center py-1">
                  <span className="text-sm text-muted-foreground">{shortcut.desc}</span>
                  <Badge variant="outline" className="font-mono text-xs">
                    {shortcut.key}
                  </Badge>
                </div>
              ))}
            </div>
            
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Close</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
      
      {/* Global Search Modal */}
      <GlobalSearchModal
        isOpen={isSearchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigateToSession={(sessionId, messageIndex) => {
          switchSession(sessionId);
          setSearchOpen(false);
        }}
      />
      
      {/* Tool Confirmation Handler */}
      <ToolConfirmationHandler websocket={websocket} />
    </div>
  );
} 