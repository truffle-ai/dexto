'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { serverRegistry } from '@/lib/serverRegistry';
import type { ServerRegistryEntry, ServerRegistryFilter } from '@/types';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "./ui/select";
import { Alert, AlertDescription } from "./ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import {
    Search,
    CheckCircle,
    ExternalLink,
    Star,
    Server,
    Grid3X3,
    List,
    ChevronDown,
    ChevronUp,
    Users,
    Plus,
    ArrowUpRight,
    Tag,
    PlusCircle,
    X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ServerRegistryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onInstallServer: (entry: ServerRegistryEntry) => Promise<'connected' | 'requires-input'>;
    onOpenConnectModal?: () => void;
    refreshTrigger?: number;
    disableClose?: boolean;
}

export default function ServerRegistryModal({
    isOpen,
    onClose,
    onInstallServer,
    onOpenConnectModal,
    refreshTrigger,
    disableClose = false,
}: ServerRegistryModalProps) {
    const [entries, setEntries] = useState<ServerRegistryEntry[]>([]);
    const [filteredEntries, setFilteredEntries] = useState<ServerRegistryEntry[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [installing, setInstalling] = useState<string | null>(null);
    
    // Filter state
    const [filter, setFilter] = useState<ServerRegistryFilter>({});
    const [searchInput, setSearchInput] = useState('');
    
    // View state
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');
    const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
    
    // Ref for debouncing
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    
    // Track if component is mounted to prevent state updates after unmount
    const isMountedRef = useRef(true);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Cleanup effect to handle unmounting
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            // Clear debounce timer
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
            // Abort any ongoing requests
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    const categories = [
        { value: 'all', label: 'All Categories' },
        { value: 'productivity', label: 'Productivity' },
        { value: 'development', label: 'Development' },
        { value: 'research', label: 'Research' },
        { value: 'creative', label: 'Creative' },
        { value: 'data', label: 'Data' },
        { value: 'communication', label: 'Communication' },
        { value: 'custom', label: 'Custom' },
    ];

    // Load entries when modal opens
    useEffect(() => {
        if (!isOpen) return;

        const loadEntries = async () => {
            // Cancel any ongoing request
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            
            // Create new AbortController for this request
            const abortController = new AbortController();
            abortControllerRef.current = abortController;

            if (!isMountedRef.current) return;
            
            setIsLoading(true);
            setError(null);
            try {
                // Sync registry with current server status first
                await serverRegistry.syncWithServerStatus();
                
                const registryEntries = await serverRegistry.getEntries();

                // Check if component is still mounted and request wasn't aborted
                if (isMountedRef.current && !abortController.signal.aborted) {
                    setEntries(registryEntries);
                    setFilteredEntries(registryEntries);
                }
            } catch (err: unknown) {
                // Only set error if component is still mounted and request wasn't aborted
                if (isMountedRef.current && !abortController.signal.aborted) {
                    const errorMessage = err instanceof Error ? err.message : 'Failed to load server registry';
                    setError(errorMessage);
                }
            } finally {
                // Only update loading state if component is still mounted and request wasn't aborted
                if (isMountedRef.current && !abortController.signal.aborted) {
                    setIsLoading(false);
                }
            }
        };

        loadEntries();
    }, [isOpen, refreshTrigger]);

    // Debounced filter function
    const debouncedApplyFilters = useCallback(async (currentFilter: ServerRegistryFilter, currentSearchInput: string) => {
        if (!isMountedRef.current) return;
        
        try {
            const filtered = await serverRegistry.getEntries({
                ...currentFilter,
                search: currentSearchInput || undefined,
            });
            
            if (isMountedRef.current) setFilteredEntries(filtered);
        } catch (err: unknown) {
            if (isMountedRef.current) {
                const errorMessage = err instanceof Error ? err.message : 'Failed to filter entries';
                setError(errorMessage);
            }
        }
    }, []);

    // Apply filters with debouncing
    useEffect(() => {
        // Clear the previous timer
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        // Set a new timer to debounce the filter operation
        debounceTimerRef.current = setTimeout(() => {
            debouncedApplyFilters(filter, searchInput);
        }, 300); // 300ms delay

        // Cleanup function to clear timer on unmount
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, [filter, searchInput, entries, debouncedApplyFilters]);

    // TODO: consolidate registry connection flows so modal + panels share a single state machine.
    const handleInstall = async (entry: ServerRegistryEntry) => {
        if (!isMountedRef.current) return;
        
        setInstalling(entry.id);
        try {
            const result = await onInstallServer(entry);

            if (result === 'connected') {
                await serverRegistry.setInstalled(entry.id, true);

                if (isMountedRef.current) {
                    setEntries(prev => prev.map(e =>
                        e.id === entry.id ? { ...e, isInstalled: true } : e
                    ));
                    setFilteredEntries(prev => prev.map(e =>
                        e.id === entry.id ? { ...e, isInstalled: true } : e
                    ));
                }
            } else if (isMountedRef.current) {
                setEntries(prev => prev.map(e =>
                    e.id === entry.id ? { ...e, isInstalled: false } : e
                ));
                setFilteredEntries(prev => prev.map(e =>
                    e.id === entry.id ? { ...e, isInstalled: false } : e
                ));
            }
        } catch (err: unknown) {
            if (isMountedRef.current) {
                const errorMessage = err instanceof Error ? err.message : 'Failed to install server';
                setError(errorMessage);
            }
        } finally {
            if (isMountedRef.current) {
                setInstalling(null);
            }
        }
    };

    const getCategoryColor = (category: string) => {
        const colors = {
            productivity: 'bg-blue-100 text-blue-800',
            development: 'bg-green-100 text-green-800',
            research: 'bg-purple-100 text-purple-800',
            creative: 'bg-pink-100 text-pink-800',
            data: 'bg-orange-100 text-orange-800',
            communication: 'bg-indigo-100 text-indigo-800',
            custom: 'bg-gray-100 text-gray-800',
        };
        return colors[category as keyof typeof colors] || colors.custom;
    };


    const isCloseBlocked = disableClose || Boolean(installing);

    const handleDialogOpenChange = useCallback((open: boolean) => {
        if (!open && !isCloseBlocked) {
            onClose();
        }
    }, [isCloseBlocked, onClose]);

    const preventCloseInteraction = isCloseBlocked
        ? (event: Event) => {
            event.preventDefault();
        }
        : undefined;

    return (
        <Dialog open={isOpen} onOpenChange={handleDialogOpenChange}>
            <DialogContent
                className="!max-w-none w-[90vw] max-h-[85vh] overflow-hidden flex flex-col !sm:max-w-none p-0"
                hideCloseButton
                onEscapeKeyDown={isCloseBlocked ? (event) => event.preventDefault() : undefined}
                onInteractOutside={preventCloseInteraction}
            >
                <DialogHeader className="pb-6 border-b px-6 pt-6">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                            <div className="p-2 rounded-lg bg-primary/10 border border-primary/20 flex-shrink-0">
                                <Server className="h-5 w-5 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <DialogTitle className="text-xl font-semibold leading-tight mb-1.5">
                                    MCP Server Registry
                                </DialogTitle>
                                <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
                                    Discover and add powerful integrations to your AI assistant
                                </DialogDescription>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                onClick={() => {
                                    if (!isCloseBlocked) {
                                        onClose();
                                    }
                                    onOpenConnectModal?.();
                                }}
                                size="sm"
                                variant="outline"
                                className="h-9 px-3 text-sm font-medium border-2 hover:bg-primary/10 hover:text-primary hover:border-primary/30 whitespace-nowrap"
                            >
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Connect Custom
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9"
                                onClick={() => onClose()}
                                disabled={isCloseBlocked}
                            >
                                <X className="h-4 w-4" />
                                <span className="sr-only">Close</span>
                            </Button>
                        </div>
                    </div>
                </DialogHeader>

                {/* Search and View Controls */}
                <div className="flex gap-3 mb-6 px-6 pt-6">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
                        <Input
                            placeholder="Search servers, integrations, and capabilities..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            className="pl-10 h-10 border-border/40 focus:border-primary/50 bg-background shadow-sm"
                        />
                    </div>
                    <Button
                        onClick={() => {
                            onClose(); // Close registry modal first
                            onOpenConnectModal?.(); // Then open connect modal
                        }}
                        size="sm"
                        variant="outline"
                        className="h-10 text-sm font-medium border-2 hover:bg-primary/10 hover:text-primary hover:border-primary/30 whitespace-nowrap"
                    >
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Connect Custom
                    </Button>
                    <div className="flex bg-muted/80 rounded-lg p-1 border border-border/40">
                        <Button
                            variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={() => {
                                setViewMode('grid');
                                setExpandedEntry(null);
                            }}
                            className={cn(
                                "h-8 px-3 rounded-md transition-all",
                                viewMode === 'grid'
                                    ? "bg-background shadow-sm"
                                    : "hover:bg-background/80"
                            )}
                        >
                            <Grid3X3 className="h-4 w-4 mr-2" />
                            Grid
                        </Button>
                        <Button
                            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={() => {
                                setViewMode('list');
                                setExpandedEntry(null);
                            }}
                            className={cn(
                                "h-8 px-3 rounded-md transition-all",
                                viewMode === 'list'
                                    ? "bg-background shadow-sm"
                                    : "hover:bg-background/80"
                            )}
                        >
                            <List className="h-4 w-4 mr-2" />
                            List
                        </Button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6">
                    {error && (
                        <Alert variant="destructive" className="mb-6 border-red-200/50 bg-red-50/50">
                            <AlertDescription className="text-red-800">{error}</AlertDescription>
                        </Alert>
                    )}

                    {isLoading ? (
                        <div className="flex items-center justify-center py-20">
                            <div className="flex flex-col items-center space-y-4">
                                <div className="h-10 w-10 border-3 border-primary/20 border-t-primary rounded-full animate-spin" />
                                <div className="text-base text-muted-foreground font-medium">Discovering servers...</div>
                                <div className="text-sm text-muted-foreground/70">Loading registry entries</div>
                            </div>
                        </div>
                    ) : filteredEntries.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <div className="p-4 rounded-2xl bg-muted/30 border border-border/20 mb-6">
                                <Server className="h-12 w-12 text-muted-foreground/60 mx-auto" />
                            </div>
                            <div className="text-lg font-medium text-muted-foreground mb-2">
                                {entries.length === 0 
                                    ? 'No servers available in the registry'
                                    : 'No servers match your search'
                                }
                            </div>
                            <div className="text-sm text-muted-foreground/70 mb-4">
                                {entries.length === 0 
                                    ? 'The registry is currently empty or failed to load'
                                    : 'Try adjusting your search terms or browse all categories'
                                }
                            </div>
                            {searchInput && (
                                <Button 
                                    variant="outline" 
                                    onClick={() => setSearchInput('')}
                                    className="border-primary/20 hover:bg-primary/5"
                                >
                                    <Search className="h-4 w-4 mr-2" />
                                    Clear search
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className={cn(
                            viewMode === 'grid' 
                                ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4" 
                                : "space-y-3"
                        )}>
                            {filteredEntries.map((entry, index) => {
                                const isExpanded = expandedEntry === entry.id;
                                const hasLongDescription = entry.description && entry.description.length > 100;
                                
                                return viewMode === 'grid' ? (
                                    <Card
                                        key={entry.id}
                                        className={cn(
                                            "group relative overflow-hidden transition-all duration-300 border-border/30 hover:border-primary/30 hover:shadow-lg bg-gradient-to-b from-card/90 to-card/50 backdrop-blur-sm flex flex-col",
                                            isExpanded && "ring-2 ring-primary/20 border-primary/50 shadow-xl"
                                        )}
                                        style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
                                    >
                                        <div
                                            className="cursor-pointer flex flex-col flex-1"
                                            onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                                        >
                                            <CardHeader className="pb-4 flex-shrink-0">
                                                <div className="flex items-start justify-between">
                                                    <div className="flex items-center gap-4 flex-1">
                                                        <div className="text-3xl p-3 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 group-hover:border-primary/30 transition-all">
                                                            {entry.icon || '⚡'}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <CardTitle className="text-base font-semibold mb-2 group-hover:text-primary transition-colors leading-tight">
                                                                {entry.name}
                                                            </CardTitle>
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                {entry.isOfficial && (
                                                                    <Badge className="text-xs px-2 py-1 bg-blue-100 text-blue-700 border-blue-200">
                                                                        <Star className="h-3 w-3 mr-1" />
                                                                        Official
                                                                    </Badge>
                                                                )}
                                                                {entry.isInstalled && (
                                                                    <Badge className="text-xs px-2 py-1 bg-green-100 text-green-700 border-green-200">
                                                                        <CheckCircle className="h-3 w-3 mr-1" />
                                                                        Connected
                                                                    </Badge>
                                                                )}
                                                                {entry.category && (
                                                                    <Badge variant="outline" className={cn(
                                                                        "text-xs px-2 py-1",
                                                                        getCategoryColor(entry.category)
                                                                    )}>
                                                                        {entry.category}
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </CardHeader>
                                            <CardContent className="pt-0 flex flex-col flex-1">
                                                <div className="flex-1">
                                                    <p className={cn(
                                                        "text-sm text-muted-foreground leading-relaxed mb-4 transition-all duration-300",
                                                        isExpanded ? "" : "line-clamp-2"
                                                    )}>
                                                        {entry.description}
                                                    </p>
                                                
                                                {isExpanded && (
                                                    <div className="space-y-4 pt-4 border-t border-border/20 animate-in slide-in-from-top-1 duration-300">
                                                        <div className="grid grid-cols-2 gap-3 text-xs">
                                                            {entry.author && (
                                                                <div className="flex items-center gap-2">
                                                                    <div className="p-1 rounded bg-muted/50">
                                                                        <Users className="h-3 w-3 text-muted-foreground" />
                                                                    </div>
                                                                    <div>
                                                                        <div className="font-medium text-foreground">Author</div>
                                                                        <div className="text-muted-foreground">{entry.author}</div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                        
                                                        {entry.tags && entry.tags.length > 0 && (
                                                            <div>
                                                                <div className="text-xs font-medium text-foreground mb-2">Tags</div>
                                                                <div className="flex flex-wrap gap-1">
                                                                    {entry.tags.slice(0, 8).map((tag) => (
                                                                        <Badge 
                                                                            key={tag} 
                                                                            variant="outline" 
                                                                            className="text-xs px-2 py-0.5 text-muted-foreground border-border/40 bg-background/50"
                                                                        >
                                                                            {tag}
                                                                        </Badge>
                                                                    ))}
                                                                    {entry.tags.length > 8 && (
                                                                        <Badge variant="outline" className="text-xs px-2 py-0.5 text-muted-foreground border-border/40 bg-background/50">
                                                                            +{entry.tags.length - 8}
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                        
                                                        {entry.homepage && (
                                                            <div className="pt-2">
                                                                <a 
                                                                    href={entry.homepage} 
                                                                    target="_blank" 
                                                                    rel="noopener noreferrer"
                                                                    className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors font-medium"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    <ExternalLink className="h-4 w-4" />
                                                                    View Documentation
                                                                </a>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                                </div>

                                                <div className="flex items-center justify-between pt-4 flex-shrink-0">
                                                    {hasLongDescription && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="text-xs text-muted-foreground hover:text-primary p-0 h-auto"
                                                        >
                                                            {isExpanded ? (
                                                                <>
                                                                    <ChevronUp className="h-3 w-3 mr-1" />
                                                                    Show less
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <ChevronDown className="h-3 w-3 mr-1" />
                                                                    Show more
                                                                </>
                                                            )}
                                                        </Button>
                                                    )}
                                                    <div className="ml-auto">
                                                        <Button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleInstall(entry);
                                                            }}
                                                            disabled={entry.isInstalled || installing === entry.id}
                                                            size="sm"
                                                            variant={entry.isInstalled ? "outline" : "default"}
                                                            className={cn(
                                                                "min-w-[75px] transition-all font-medium",
                                                                installing === entry.id && "opacity-70",
                                                                !entry.isInstalled && "bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-md hover:shadow-lg"
                                                            )}
                                                        >
                                                            {installing === entry.id ? (
                                                                <div className="flex items-center gap-2">
                                                                    <div className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                                                    <span>Connecting</span>
                                                                </div>
                                                            ) : entry.isInstalled ? (
                                                                <div className="flex items-center gap-2">
                                                                    <CheckCircle className="h-3 w-3" />
                                                                    <span>Connected</span>
                                                                </div>
                                                            ) : (
                                                                <div className="flex items-center gap-2">
                                                                    <Plus className="h-3 w-3" />
                                                                    <span>Connect</span>
                                                                </div>
                                                            )}
                                                        </Button>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </div>
                                    </Card>
                                ) : (
                                    <Card 
                                        key={entry.id} 
                                        className={cn(
                                            "group transition-all duration-200 border-border/30 hover:border-primary/20 hover:shadow-md bg-card/50 hover:bg-card/80 cursor-pointer !py-0 !gap-0",
                                            isExpanded && "border-primary/30 shadow-lg bg-card/90",
                                            hasLongDescription && "hover:bg-card/85"
                                        )}
                                        onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                                    >
                                        <div className="p-4">
                                            <div className="flex items-start gap-4">
                                                {/* Icon */}
                                                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/15 flex items-center justify-center text-lg font-medium">
                                                    {entry.icon || '⚡'}
                                                </div>
                                                
                                                {/* Content */}
                                                <div className="flex-1 min-w-0 space-y-3">
                                                    {/* Header */}
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 mb-2">
                                                                <h3 className="text-base font-medium text-foreground group-hover:text-primary transition-colors leading-tight">
                                                                    {entry.name}
                                                                </h3>
                                                                {hasLongDescription && (
                                                                    <ChevronDown className={cn(
                                                                        "h-4 w-4 text-muted-foreground/60 transition-all duration-200 flex-shrink-0",
                                                                        isExpanded && "rotate-180 text-muted-foreground"
                                                                    )} />
                                                                )}
                                                            </div>
                                                            
                                                            {/* Badges */}
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                {entry.isOfficial && (
                                                                    <Badge className="text-xs font-medium px-2 py-0.5 bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-100">
                                                                        <Star className="h-2.5 w-2.5 mr-1 fill-current" />
                                                                        Official
                                                                    </Badge>
                                                                )}
                                                                {entry.isInstalled && (
                                                                    <Badge className="text-xs font-medium px-2 py-0.5 bg-green-50 text-green-600 border-green-100">
                                                                        <CheckCircle className="h-2.5 w-2.5 mr-1" />
                                                                        Connected
                                                                    </Badge>
                                                                )}
                                                                <Badge variant="outline" className="text-xs font-medium px-2 py-0.5 bg-background/50 text-muted-foreground border-border/40 capitalize">
                                                                    {entry.category}
                                                                </Badge>
                                                            </div>
                                                        </div>
                                                        
                                                        {/* Action Button */}
                                                        <Button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleInstall(entry);
                                                            }}
                                                            disabled={entry.isInstalled || installing === entry.id}
                                                            size="sm"
                                                            variant={entry.isInstalled ? "outline" : "default"}
                                                            className={cn(
                                                                "min-w-[80px] h-8 text-xs font-medium transition-all",
                                                                installing === entry.id && "opacity-70",
                                                                !entry.isInstalled && "bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-sm hover:shadow-md"
                                                            )}
                                                        >
                                                            {installing === entry.id ? (
                                                                <div className="flex items-center gap-1.5">
                                                                    <div className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                                                    <span>Connecting...</span>
                                                                </div>
                                                            ) : entry.isInstalled ? (
                                                                <div className="flex items-center gap-1.5">
                                                                    <CheckCircle className="h-3 w-3" />
                                                                    <span>Connected</span>
                                                                </div>
                                                            ) : (
                                                                <div className="flex items-center gap-1.5">
                                                                    <Plus className="h-3 w-3" />
                                                                    <span>Connect</span>
                                                                </div>
                                                            )}
                                                        </Button>
                                                    </div>
                                                    
                                                    {/* Description */}
                                                    <div>
                                                        <p className={cn(
                                                            "text-sm text-muted-foreground leading-relaxed transition-all duration-300",
                                                            isExpanded ? "" : "line-clamp-2"
                                                        )}>
                                                            {entry.description}
                                                        </p>
                                                    </div>
                                                    
                                                    {/* Expanded Content */}
                                                    {isExpanded && (
                                                        <div className="space-y-4 pt-4 border-t border-border/10 animate-in slide-in-from-top-2 duration-300">
                                                            {entry.author && (
                                                                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/10">
                                                                    <div className="p-2 rounded-lg bg-primary/10">
                                                                        <Users className="h-4 w-4 text-primary" />
                                                                    </div>
                                                                    <div>
                                                                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Author</div>
                                                                        <div className="text-sm font-medium text-foreground">{entry.author}</div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                            
                                                            {entry.tags && entry.tags.length > 0 && (
                                                                <div>
                                                                    <div className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                                                                        <Tag className="h-4 w-4 text-primary" />
                                                                        Tags
                                                                    </div>
                                                                    <div className="flex flex-wrap gap-2">
                                                                        {entry.tags.map((tag) => (
                                                                            <Badge 
                                                                                key={tag} 
                                                                                variant="outline" 
                                                                                className="text-xs px-3 py-1 text-muted-foreground border-border/40 bg-background/60 hover:bg-background/80 transition-colors"
                                                                            >
                                                                                {tag}
                                                                            </Badge>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                            
                                                            {entry.homepage && (
                                                                <div className="pt-2">
                                                                    <a 
                                                                        href={entry.homepage} 
                                                                        target="_blank" 
                                                                        rel="noopener noreferrer"
                                                                        className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors font-medium px-4 py-2 rounded-lg border border-primary/20 hover:border-primary/40 bg-primary/5 hover:bg-primary/10"
                                                                        onClick={(e) => e.stopPropagation()}
                                                                    >
                                                                        <ExternalLink className="h-4 w-4" />
                                                                        View Documentation
                                                                    </a>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </div>
            </DialogContent>

        </Dialog>
    );
} 
