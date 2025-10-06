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
import CustomizePanel from './AgentEditor/CustomizePanel';
import { Button } from "./ui/button";
import { Server, Download, Wrench, Keyboard, AlertTriangle, Plus, MoreHorizontal, MessageSquare, Trash2, Search, Settings, PanelLeft, ChevronDown, FlaskConical, Check, FileEditIcon } from "lucide-react";
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
import NewChatButton from './NewChatButton';
import SettingsModal from './SettingsModal';
import AgentSelector from './AgentSelector';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './ui/tooltip';
import { serverRegistry } from '@/lib/serverRegistry';
import type { McpServerConfig } from '@dexto/core';

export default function ChatApp() {

  const [isMac, setIsMac] = useState(false);
  const { messages, sendMessage, currentSessionId, switchSession, isWelcomeState, returnToWelcome, websocket, activeError, clearError, processing, cancel, greeting } = useChatContext();

  const [isModalOpen, setModalOpen] = useState(false);
  const [isServerRegistryOpen, setServerRegistryOpen] = useState(false);
  const [isServersPanelOpen, setServersPanelOpen] = useState(false);
  const [isSessionsPanelOpen, setSessionsPanelOpen] = useState(false);
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [isExportOpen, setExportOpen] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [isCustomizePanelOpen, setCustomizePanelOpen] = useState(false);
  const [exportName, setExportName] = useState('dexto-config');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportContent, setExportContent] = useState<string>('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Enhanced features
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Conversation management states
  const [isDeleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Welcome screen search state
  const [welcomeSearchQuery, setWelcomeSearchQuery] = useState('');

  // Scroll management for robust autoscroll
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const listContentRef = React.useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isScrollingToBottom, setIsScrollingToBottom] = useState(false);
  const [followStreaming, setFollowStreaming] = useState(false);
  const lastScrollTopRef = React.useRef(0);
  // Improved "Scroll to bottom" hint
  const [showScrollHint, setShowScrollHint] = useState(false);
  const scrollIdleTimerRef = React.useRef<number | null>(null);

  // Server refresh trigger
  const [serversRefreshTrigger, setServersRefreshTrigger] = useState(0);
  // Prefill config for ConnectServerModal
  const [connectPrefill, setConnectPrefill] = useState<{
    name: string;
    config: Partial<McpServerConfig> & { type?: 'stdio' | 'sse' | 'http' };
    lockName?: boolean;
    registryEntryId?: string;
  } | null>(null);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)) {
      setIsMac(true);
    }
  }, []);

  const recomputeIsAtBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 1;
    setIsAtBottom(nearBottom);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setIsScrollingToBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior });
    // Release the lock on next frame to allow ResizeObserver to settle
    requestAnimationFrame(() => setIsScrollingToBottom(false));
  }, []);

  // Observe user scroll position
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      // When user scrolls up, disable followStreaming
      const prev = lastScrollTopRef.current;
      const curr = el.scrollTop;
      if (!isScrollingToBottom && followStreaming && curr < prev) {
        setFollowStreaming(false);
      }
      lastScrollTopRef.current = curr;
      recomputeIsAtBottom();

      // Debounced hint: show when not at bottom after scrolling stops
      const nearBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 1;
      if (nearBottom) {
        setShowScrollHint(false);
        if (scrollIdleTimerRef.current) {
          window.clearTimeout(scrollIdleTimerRef.current);
          scrollIdleTimerRef.current = null;
        }
      } else {
        setShowScrollHint(false);
        if (scrollIdleTimerRef.current) window.clearTimeout(scrollIdleTimerRef.current);
        scrollIdleTimerRef.current = window.setTimeout(() => {
          setShowScrollHint(true);
        }, 180);
      }
    };
    el.addEventListener('scroll', onScroll);
    // Initial compute in case of restored sessions
    recomputeIsAtBottom();
    return () => el.removeEventListener('scroll', onScroll);
  }, [recomputeIsAtBottom, followStreaming, isScrollingToBottom, isWelcomeState]);

  // Content resize observer to autoscroll on content growth
  useEffect(() => {
    const content = listContentRef.current;
    if (!content) return;
    const ro = new ResizeObserver(() => {
      if (isScrollingToBottom) return;
      if (followStreaming || isAtBottom) scrollToBottom('auto');
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [isAtBottom, isScrollingToBottom, followStreaming, scrollToBottom, isWelcomeState]);

  // Fallback: if messages change during streaming, ensure we keep following
  useEffect(() => {
    if (followStreaming) scrollToBottom('auto');
  }, [followStreaming, messages, scrollToBottom]);

  // Position the last user message near the top then follow streaming
  const positionLastUserNearTop = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const nodes = container.querySelectorAll('[data-role="user"]');
    const el = nodes[nodes.length - 1] as HTMLElement | undefined;
    if (!el) {
      // Fallback to bottom
      scrollToBottom('auto');
      return;
    }
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const offsetTop = eRect.top - cRect.top + container.scrollTop;
    const target = Math.max(offsetTop - 16, 0);
    setIsScrollingToBottom(true);
    container.scrollTo({ top: target, behavior: 'auto' });
    requestAnimationFrame(() => setIsScrollingToBottom(false));
  }, [scrollToBottom]);

  useEffect(() => {
    if (isExportOpen) {
      // Include current session ID in config export if available
      const exportUrl = currentSessionId
        ? `/api/agent/config/export?sessionId=${currentSessionId}`
        : '/api/agent/config/export';

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
        ? `/api/agent/config/export?sessionId=${currentSessionId}`
        : '/api/agent/config/export';

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
      // After sending, position the new user message near the top,
      // then enable followStreaming to follow the assistant reply.
      setTimeout(() => {
        positionLastUserNearTop();
        setFollowStreaming(true);
      }, 0);
    } catch (error) {
      console.error('Failed to send message:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to send message');
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setIsSendingMessage(false);
    }
  }, [sendMessage, positionLastUserNearTop]);

  // Hook into existing custom events to toggle followStreaming
  useEffect(() => {
    const onStart = () => setFollowStreaming(true);
    const onEnd = () => setFollowStreaming(false);
    window.addEventListener('dexto:message', onStart as EventListener);
    window.addEventListener('dexto:response', onEnd as EventListener);
    return () => {
      window.removeEventListener('dexto:message', onStart as EventListener);
      window.removeEventListener('dexto:response', onEnd as EventListener);
    };
  }, []);

  const handleSessionChange = useCallback((sessionId: string) => {
    switchSession(sessionId);
    setSessionsPanelOpen(false);
  }, [switchSession]);

  const handleInstallServer = useCallback(async (entry: any) => {
    // Open Connect modal with prefilled config
    const config = {
      type: entry.config.type,
      command: entry.config.command,
      args: entry.config.args || [],
      url: entry.config.url,
      env: entry.config.env || {},
      headers: entry.config.headers || {},
      timeout: entry.config.timeout || 30000,
    };
    setConnectPrefill({ name: entry.name, config, lockName: true, registryEntryId: entry.id });
    setServerRegistryOpen(false);
    setModalOpen(true);
  }, []);

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

  const createAndSwitchSession = useCallback(async () => {
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorBody = await response.json();
          errorMessage = errorBody.message || errorBody.error || errorMessage;
        } catch {
          // If we can't parse the error body, use the status text
        }
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      handleSessionChange(data.session.id);
    } catch (error) {
      console.error('Error creating new session:', error);
      setErrorMessage('Failed to create new session. Please try again.');
      setTimeout(() => setErrorMessage(null), 5000);
    }
  }, [handleSessionChange]);

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
      // Cmd/Ctrl + Backspace to delete current session
      if ((e.metaKey || e.ctrlKey) && e.key === 'Backspace') {
        if (currentSessionId && !isWelcomeState) {
          e.preventDefault();
          // If session has messages, show confirmation dialog
          if (messages.length > 0) {
            setDeleteDialogOpen(true);
          } else {
            // No messages, delete immediately
            handleDeleteConversation();
          }
        }
      }
      // Ctrl/Cmd + H to toggle sessions panel
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'h') {
        e.preventDefault();
        setSessionsPanelOpen(prev => !prev);
      }
      // Ctrl/Cmd + K to create new session
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'k') {
        e.preventDefault();
        createAndSwitchSession();
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
      // Ctrl/Cmd + L to open MCP playground
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'l') {
        e.preventDefault();
        window.open('/playground', '_blank');
      }
      // Ctrl/Cmd + E to open customize panel
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'e') {
        e.preventDefault();
        setCustomizePanelOpen(prev => !prev);
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
      // Escape to close panels or cancel run
      if (e.key === 'Escape') {
        if (isCustomizePanelOpen) setCustomizePanelOpen(false);
        else if (isServersPanelOpen) setServersPanelOpen(false);
        else if (isSessionsPanelOpen) setSessionsPanelOpen(false);
        else if (isServerRegistryOpen) setServerRegistryOpen(false);
        else if (isExportOpen) setExportOpen(false);
        else if (showShortcuts) setShowShortcuts(false);
        else if (isDeleteDialogOpen) setDeleteDialogOpen(false);
        else if (errorMessage) setErrorMessage(null);
        else if (processing) cancel(currentSessionId || undefined);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCustomizePanelOpen, isServersPanelOpen, isSessionsPanelOpen, isSearchOpen, isServerRegistryOpen, isExportOpen, showShortcuts, isDeleteDialogOpen, errorMessage, setSearchOpen]);

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
            onNewChat={createAndSwitchSession}
          />
        )}
      </div>

      <main
        className="flex-1 flex flex-col relative"
        style={{ '--thread-max-width': '54rem' } as React.CSSProperties & { '--thread-max-width': string }}
      >
        {/** Shared centered content width for welcome, messages, and composer */}
        {/** Keep this in sync to unify UI width like other chat apps */}
        {/** 720px base, expand to ~2xl on sm, ~3xl on lg */}
        {/* Unused var directive removed; keep code clean */}
        {(() => {
          /* no-op to allow inline constant-like usage below via variable */
          return null;
        })()}
        {/* Clean Header */}
        <header className="shrink-0 border-b border-border/50 bg-background/95 backdrop-blur-xl shadow-sm">
          <div className="grid grid-cols-3 items-center px-4 py-3">
            {/* Left Section */}
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
              
              {/* New Chat Button - visible in header only when sidebar is closed */}
              {!isSessionsPanelOpen && (
                <NewChatButton onClick={createAndSwitchSession} />
              )}
              
              {/* TODO: improve the non text part of logo */}
              <a 
                href="https://dexto.ai" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center space-x-3 hover:opacity-80 transition-opacity"
              >
                <img src="/logos/dexto/dexto_logo_light.svg" alt="Dexto" className="h-12 w-auto dark:hidden" />
                <img src="/logos/dexto/dexto_logo.svg" alt="Dexto" className="h-12 w-auto hidden dark:block" />
                <span className="sr-only">Dexto</span>
              </a>
              
              {/* Current Session Indicator - Only show when there's an active session */}
              {currentSessionId && !isWelcomeState && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="text-xs bg-muted/50 border-border/30 max-w-[120px] cursor-help">
                      <span className="truncate">
                        {currentSessionId.length > 12 ? `${currentSessionId.slice(0, 12)}...` : currentSessionId}
                      </span>
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span className="font-mono">{currentSessionId}</span>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            {/* Center Section - Agent Selector */}
            <div className="flex justify-center">
              <AgentSelector mode="badge" />
            </div>

            {/* Right Section */}
            <div className="flex items-center justify-end">
              <div className="mr-4">
                <ThemeSwitch />
              </div>
              <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCustomizePanelOpen(!isCustomizePanelOpen)}
                    className={cn(
                      "h-8 w-8 p-0",
                      isCustomizePanelOpen && "bg-muted"
                    )}
                    aria-label="Customize agent"
                  >
                    <FileEditIcon className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Customize Agent (⌘E)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSettingsOpen(true)}
                    className="h-8 w-8 p-0"
                    aria-label="Open settings"
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Settings</TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setServersPanelOpen(!isServersPanelOpen)}
                    className={cn(
                      "h-8 px-2 text-sm transition-colors",
                      isServersPanelOpen && "bg-muted"
                    )}
                  >
                    <Wrench className="h-3.5 w-3.5" />
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
                    className="h-8 px-2 text-sm"
                  >
                    <Link href="/playground" target="_blank" rel="noopener noreferrer">
                      <FlaskConical className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline ml-1.5">Playground</span>
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Open MCP playground (⌘L)
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
          </div>
        </header>
        
        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Toasts */}
          {successMessage && (
            <div className="fixed bottom-4 right-4 z-50 border border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 text-foreground px-3 py-2 rounded-md shadow-md inline-flex items-center gap-2">
              <Check className="h-4 w-4 text-green-600" />
              <span className="text-sm">{successMessage}</span>
            </div>
          )}
          {/* Error Message */}
          {errorMessage && (
            <div className="absolute top-4 right-4 z-50 bg-destructive text-destructive-foreground px-4 py-2 rounded-md shadow-lg">
              {errorMessage}
            </div>
          )}
          
          {/* Chat Content */}
          <div className="flex-1 flex flex-col min-h-0">
            {isWelcomeState || messages.length === 0 ? (
              /* Modern Welcome Screen with Central Search */
              <div className="flex-1 flex items-center justify-center p-6 -mt-20">
                <div className="w-full max-w-[var(--thread-max-width)] mx-auto space-y-6">
                  <div className="text-center space-y-3">
                    <div className="flex items-center justify-center gap-3">
                      <img src="/logos/dexto/dexto_logo_icon.svg" alt="Dexto" className="h-12 w-auto" />
                      <h2 className="text-2xl font-bold font-mono tracking-tight bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                        {greeting ?? "Welcome to Dexto"}
                      </h2>
                    </div>
                    <p className="text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
                      Your AI assistant with powerful tools. Ask anything or connect new capabilities.
                    </p>
                  </div>

                  {/* Quick Actions Grid - Compact */}
                  <div className="flex flex-wrap justify-center gap-2 max-w-[var(--thread-max-width)] mx-auto">
                    {quickActions.map((action, index) => (
                      <button
                        key={index}
                        onClick={action.action}
                        className="group px-3 py-2 text-left rounded-full bg-primary/5 hover:bg-primary/10 transition-all duration-200 hover:shadow-sm hover:scale-105"
                      >
                        <div className="flex items-center space-x-1.5">
                          <span className="text-sm">{action.icon}</span>
                          <span className="font-medium text-sm text-primary group-hover:text-primary/80 transition-colors">
                            {action.title}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Central Search Bar with Full Features */}
                  <div className="max-w-[var(--thread-max-width)] mx-auto">
                    <InputArea
                      onSend={handleSend}
                      isSending={isSendingMessage}
                      variant="welcome"
                    />
                  </div>
                
                  {/* Quick Tips */}
                  <div className="text-xs text-muted-foreground space-y-1 text-center">
                    <p>
                      💡 Try
                      <kbd className="px-1 py-0.5 bg-muted rounded text-xs ml-1">⌘K</kbd> for new chat,
                      <kbd className="px-1 py-0.5 bg-muted rounded text-xs ml-1">⌘J</kbd> for tools,
                      <kbd className="px-1 py-0.5 bg-muted rounded text-xs ml-1">⌘L</kbd> for playground,
                      <kbd className="px-1 py-0.5 bg-muted rounded text-xs ml-1">{isMac ? '⌘⌫' : 'Ctrl+⌫'}</kbd> to delete session,
                      <kbd className="px-1 py-0.5 bg-muted rounded text-xs ml-1">⌘/</kbd> for shortcuts
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              /* Messages Area */
              <div className="flex-1 min-h-0 overflow-hidden">
                <div ref={scrollContainerRef} className="h-full overflow-y-auto overscroll-contain relative">
                  {/* Ensure the input dock sits at the very bottom even if content is short */}
                  <div className="min-h-full grid grid-rows-[1fr_auto]">
                    <div className="w-full max-w-[var(--thread-max-width)] mx-auto">
                      <MessageList 
                        messages={messages}
                        activeError={activeError}
                        onDismissError={clearError}
                        outerRef={listContentRef}
                      />
                    </div>
                    {/* Sticky input dock inside scroll viewport */}
                    <div className="sticky bottom-0 z-10 px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+16px)] bg-background relative">
                      {showScrollHint && (
                        <div className="absolute left-1/2 -translate-x-1/2 -top-3 z-20 pointer-events-none">
                          <button
                            onClick={() => {
                              setShowScrollHint(false);
                              scrollToBottom('smooth');
                            }}
                            className="pointer-events-auto px-3 py-1.5 rounded-full shadow-sm bg-background/95 border border-border/60 backdrop-blur supports-[backdrop-filter]:bg-background/80 text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
                          >
                            <span>Scroll to bottom</span>
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                      <div className="w-full max-w-[var(--thread-max-width)] mx-auto pointer-events-auto">
                        <InputArea
                          onSend={handleSend}
                          isSending={isSendingMessage}
                          variant="chat"
                        />
                      </div>
                    </div>
                  </div>
                  {/* Scroll to bottom button */}
                  {/* Scroll hint now rendered inside sticky dock */}
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
                onOpenConnectWithPrefill={(opts) => {
                  setConnectPrefill(opts);
                  setModalOpen(true);
                }}
                variant="inline"
                refreshTrigger={serversRefreshTrigger}
              />
            )}
          </div>
        </div>

        {/* Customize Panel - Overlay Animation */}
        <CustomizePanel
          isOpen={isCustomizePanelOpen}
          onClose={() => setCustomizePanelOpen(false)}
          variant="overlay"
        />
        
        {/* Connect Server Modal */}
        <ConnectServerModal 
          isOpen={isModalOpen} 
          onClose={() => {
            setModalOpen(false);
            setConnectPrefill(null);
          }} 
          onServerConnected={async () => {
            // Mark the associated registry entry as installed, if applicable
            if (connectPrefill?.registryEntryId) {
              try {
                await serverRegistry.setInstalled(connectPrefill.registryEntryId, true);
              } catch (e) {
                // non-fatal; continue
                console.warn('Failed to mark registry entry installed:', e);
              }
            }
            // Trigger a refresh of the servers panel
            setServersRefreshTrigger(prev => prev + 1);
            // Show success toast
            const name = connectPrefill?.name || 'Server';
            setSuccessMessage(`Added ${name}`);
            setTimeout(() => setSuccessMessage(null), 4000);
          }}
          initialName={connectPrefill?.name}
          initialConfig={connectPrefill?.config}
          lockName={connectPrefill?.lockName}
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

        {/* Settings Modal */}
        <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />


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
                { key: '⌘E', desc: 'Customize agent' },
                { key: '⌘⇧S', desc: 'Search conversations' },
                { key: '⌘L', desc: 'Open MCP playground' },
                { key: '⌘⇧E', desc: 'Export config' },
                { key: '⌘/', desc: 'Show shortcuts' },
                { key: isMac ? '⌘⌫' : 'Ctrl+⌫', desc: 'Delete current session' },
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
