'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useChatContext } from './hooks/ChatContext';
import MessageList from './MessageList';
import InputArea from './InputArea';
import ConnectServerModal from './ConnectServerModal';
import ServerRegistryModal from './ServerRegistryModal';
import ServersPanel from './ServersPanel';
import SessionPanel from './SessionPanel';
import { Button } from "./ui/button";
import { Server, Download, Wrench, Keyboard, AlertTriangle, Plus, MoreHorizontal, MessageSquare } from "lucide-react";
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
} from './ui/dropdown-menu';

export default function ChatApp() {
  const { messages, sendMessage, currentSessionId, switchSession } = useChatContext();

  const [isModalOpen, setModalOpen] = useState(false);
  const [isServerRegistryOpen, setServerRegistryOpen] = useState(false);
  const [isServersPanelOpen, setServersPanelOpen] = useState(false);
  const [isSessionsPanelOpen, setSessionsPanelOpen] = useState(false);
  const [isExportOpen, setExportOpen] = useState(false);
  const [exportName, setExportName] = useState('saiki-config');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportContent, setExportContent] = useState<string>('');
  const [copySuccess, setCopySuccess] = useState(false);
  
  // Enhanced features
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    if (isExportOpen) {
      // Include current session ID in config export if available
      const exportUrl = currentSessionId && currentSessionId !== 'default' 
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
      const exportUrl = currentSessionId && currentSessionId !== 'default' 
        ? `/api/config.yaml?sessionId=${currentSessionId}`
        : '/api/config.yaml';
      
      const res = await fetch(exportUrl);
      if (!res.ok) throw new Error('Failed to fetch configuration');
      const yamlText = await res.text();
      const blob = new Blob([yamlText], { type: 'application/x-yaml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const fileName = currentSessionId && currentSessionId !== 'default'
        ? `${exportName}-${currentSessionId}.yml`
        : `${exportName}.yml`;
      link.download = fileName;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExportOpen(false);
      setExportError(null);
    } catch (err) {
      console.error('Export failed:', err);
      setExportError(err instanceof Error ? err.message : 'Export failed');
    }
  }, [exportName, currentSessionId]);

  const handleCopy = useCallback(async () => {
    try {
      const exportUrl = currentSessionId && currentSessionId !== 'default' 
        ? `/api/config.yaml?sessionId=${currentSessionId}`
        : '/api/config.yaml';
      
      const res = await fetch(exportUrl);
      if (!res.ok) throw new Error('Failed to fetch configuration');
      const yamlText = await res.text();
      await navigator.clipboard.writeText(yamlText);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
      setExportError(null);
    } catch (err) {
      console.error('Copy failed:', err);
      setExportError(err instanceof Error ? err.message : 'Copy failed');
    }
  }, [setCopySuccess, setExportError, currentSessionId]);

  const handleInstallServer = useCallback(async (entry: any) => {
    // This will be implemented to install servers from the registry
    console.log('Installing server:', entry);
    // For now, just close the modal
    setServerRegistryOpen(false);
  }, []);

  const handleSend = useCallback(async (content: string, imageData?: { base64: string; mimeType: string }) => {
    setIsSendingMessage(true);
    try {
      await sendMessage(content, imageData);
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setIsSendingMessage(false);
    }
  }, [sendMessage]);

  const handleSessionChange = useCallback(async (sessionId: string) => {
    try {
      await switchSession(sessionId);
      // Close sessions panel after switching (for mobile experience)
      setSessionsPanelOpen(false);
    } catch (error) {
      console.error('Error switching session:', error);
    }
  }, [switchSession]);

  const quickActions = [
    {
      title: "What can you do?",
      description: "See my current capabilities",
      action: () => handleSend("What tools and capabilities do you have available right now?"),
      icon: "🤔"
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
      title: "Test existing tools",
      description: "Try out connected capabilities",
      action: () => handleSend("Show me how to use one of your available tools. Pick an interesting one and demonstrate it."),
      icon: "🧪"
    }
  ];

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + J to toggle tools panel
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'j') {
        e.preventDefault();
        setServersPanelOpen(prev => !prev);
      }
      // Ctrl/Cmd + Shift + J to open playground
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'j') {
        e.preventDefault();
        window.open('/playground', '_blank');
      }
      // Ctrl/Cmd + Shift + S to toggle sessions panel
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 's') {
        e.preventDefault();
        setSessionsPanelOpen(prev => !prev);
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
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isServersPanelOpen, isSessionsPanelOpen, isServerRegistryOpen, isExportOpen, showShortcuts]);

  return (
    <div className="flex h-screen bg-background">
      <main className="flex-1 flex flex-col relative">
        {/* Simplified Header */}
        <header className="shrink-0 border-b border-border/50 bg-background/80 backdrop-blur-xl">
          <div className="flex justify-between items-center px-4 py-3">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <div className="flex items-center justify-center w-7 h-7 rounded-lg border border-border/50 text-primary-foreground">
                  <img src="/logo.png" alt="Saiki" className="w-4 h-4" />
                </div>
                <h1 className="text-base font-semibold tracking-tight">Saiki</h1>
              </div>
              
              {/* Current Session Indicator */}
              {currentSessionId && (
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className="text-xs">
                    {currentSessionId === 'default' ? 'Default Chat' : currentSessionId}
                  </Badge>
                </div>
              )}
            </div>
          
            {/* Minimal Action Bar */}
            <div className="flex items-center space-x-1">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setSessionsPanelOpen(!isSessionsPanelOpen)}
                className={cn(
                  "h-8 px-2 text-xs transition-colors",
                  isSessionsPanelOpen && "bg-muted"
                )}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span className="hidden sm:inline ml-1.5">Sessions</span>
              </Button>
              
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
                <span className="hidden sm:inline ml-1.5">MCP Servers</span>
              </Button>
            
              <Button 
                variant="ghost"
                size="sm"
                asChild
                className="h-8 px-2 text-xs"
              >
                <Link href="/playground" target="_blank">
                  <Wrench className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline ml-1.5">MCP Playground</span>
                </Link>
              </Button>
            
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
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>
        
        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Chat Content */}
          <div className="flex-1 flex flex-col">
            {messages.length === 0 ? (
              /* Welcome Screen - Clean Design */
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="w-full max-w-2xl mx-auto text-center space-y-8">
                  <div className="space-y-4">
                    <div className="flex items-center justify-center w-16 h-16 mx-auto rounded-2xl bg-primary/10 text-primary">
                      <img src="/logo.png" alt="Saiki" className="w-8 h-8" />
                    </div>
                    <div className="space-y-2">
                      <h2 className="text-2xl font-semibold tracking-tight font-mono bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">Hello, I'm Saiki!</h2>
                      <p className="text-muted-foreground text-base">
                        Try asking me something or connect new tools to expand what I can do
                      </p>
                      {currentSessionId !== 'default' && (
                        <p className="text-sm text-muted-foreground">
                          Currently in session: <span className="font-mono">{currentSessionId}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Quick Actions Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto">
                    {quickActions.map((action, index) => (
                      <button
                        key={index}
                        onClick={action.action}
                        className="group p-4 text-left rounded-xl border border-border/50 bg-card hover:bg-muted/50 transition-all duration-200 hover:border-border hover:shadow-minimal"
                      >
                        <div className="flex items-center space-x-3">
                          <span className="text-lg">{action.icon}</span>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-sm group-hover:text-foreground transition-colors">
                              {action.title}
                            </h3>
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {action.description}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                
                  {/* Quick Tips */}
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>💡 Try <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">⌘⇧S</kbd> for sessions, <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">⌘⇧J</kbd> for tools, <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">⌘⇧P</kbd> for playground</p>
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
            
            {/* Input Area */}
            <div className="shrink-0 border-t border-border/50 bg-background/80 backdrop-blur-xl">
              <div className="p-4">
                <InputArea
                  onSend={handleSend}
                  isSending={isSendingMessage}
                />
              </div>
            </div>
          </div>

          {/* Sessions Panel - Slide Animation */}
          <div className={cn(
            "shrink-0 transition-all duration-300 ease-in-out border-l border-border/50 bg-card",
            isSessionsPanelOpen ? "w-80" : "w-0 overflow-hidden"
          )}>
            {isSessionsPanelOpen && (
              <SessionPanel
                isOpen={isSessionsPanelOpen}
                onClose={() => setSessionsPanelOpen(false)}
                currentSessionId={currentSessionId}
                onSessionChange={handleSessionChange}
                variant="inline"
              />
            )}
          </div>

          {/* Servers Panel - Slide Animation */}
          <div className={cn(
            "shrink-0 transition-all duration-300 ease-in-out border-l border-border/50 bg-card",
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
                {currentSessionId !== 'default' && (
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
                  placeholder="saiki-config"
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
                { key: '⌘ ⇧ S', desc: 'Toggle sessions panel' },
                { key: '⌘ J', desc: 'Toggle tools panel' },
                { key: '⌘ ⇧ J', desc: 'Open playground' },
                { key: '⌘ ⇧ E', desc: 'Export config' },
                { key: '⌘ /', desc: 'Show shortcuts' },
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
    </div>
  );
} 