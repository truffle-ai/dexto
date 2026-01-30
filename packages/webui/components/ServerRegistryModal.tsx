import React, { useState, useEffect, useRef, useCallback } from 'react';
import { serverRegistry } from '@/lib/serverRegistry';
import type { ServerRegistryEntry, ServerRegistryFilter } from '@dexto/registry';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
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
    const [filter] = useState<ServerRegistryFilter>({});
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
                    const errorMessage =
                        err instanceof Error ? err.message : 'Failed to load server registry';
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
    const debouncedApplyFilters = useCallback(
        async (currentFilter: ServerRegistryFilter, currentSearchInput: string) => {
            if (!isMountedRef.current) return;

            try {
                const filtered = await serverRegistry.getEntries({
                    ...currentFilter,
                    search: currentSearchInput || undefined,
                });

                if (isMountedRef.current) setFilteredEntries(filtered);
            } catch (err: unknown) {
                if (isMountedRef.current) {
                    const errorMessage =
                        err instanceof Error ? err.message : 'Failed to filter entries';
                    setError(errorMessage);
                }
            }
        },
        []
    );

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
                    setEntries((prev) =>
                        prev.map((e) => (e.id === entry.id ? { ...e, isInstalled: true } : e))
                    );
                    setFilteredEntries((prev) =>
                        prev.map((e) => (e.id === entry.id ? { ...e, isInstalled: true } : e))
                    );
                }
            } else if (isMountedRef.current) {
                setEntries((prev) =>
                    prev.map((e) => (e.id === entry.id ? { ...e, isInstalled: false } : e))
                );
                setFilteredEntries((prev) =>
                    prev.map((e) => (e.id === entry.id ? { ...e, isInstalled: false } : e))
                );
            }
        } catch (err: unknown) {
            if (isMountedRef.current) {
                const errorMessage =
                    err instanceof Error ? err.message : 'Failed to install server';
                setError(errorMessage);
            }
        } finally {
            if (isMountedRef.current) {
                setInstalling(null);
            }
        }
    };

    // Theme spec: Subtle, professional badge colors with soft backgrounds
    const getCategoryColor = (category: string) => {
        const colors = {
            productivity: 'bg-blue-50 text-blue-700 border-blue-200/60',
            development: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
            research: 'bg-purple-50 text-purple-700 border-purple-200/60',
            creative: 'bg-pink-50 text-pink-700 border-pink-200/60',
            data: 'bg-amber-50 text-amber-700 border-amber-200/60',
            communication: 'bg-indigo-50 text-indigo-700 border-indigo-200/60',
            custom: 'bg-slate-50 text-slate-700 border-slate-200/60',
        };
        return colors[category as keyof typeof colors] || colors.custom;
    };

    const isCloseBlocked = disableClose || Boolean(installing);

    const handleDialogOpenChange = useCallback(
        (open: boolean) => {
            if (!open && !isCloseBlocked) {
                onClose();
            }
        },
        [isCloseBlocked, onClose]
    );

    const preventCloseInteraction = isCloseBlocked
        ? (event: Event) => {
              event.preventDefault();
          }
        : undefined;

    return (
        <Dialog open={isOpen} onOpenChange={handleDialogOpenChange}>
            <DialogContent
                className="!max-w-none w-[90vw] max-h-[85vh] overflow-hidden flex flex-col !sm:max-w-none p-0 bg-gradient-to-b from-background via-background to-muted/20"
                hideCloseButton
                onEscapeKeyDown={isCloseBlocked ? (event) => event.preventDefault() : undefined}
                onInteractOutside={preventCloseInteraction}
            >
                {/* Theme: Compact header with refined typography and subtle background */}
                <DialogHeader className="pb-4 border-b px-6 pt-5 bg-gradient-to-r from-muted/30 via-transparent to-transparent">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-primary/10 border border-primary/20 flex-shrink-0">
                                <Server className="h-5 w-5 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <DialogTitle className="text-lg font-semibold leading-tight mb-1">
                                    MCP Server Registry
                                </DialogTitle>
                                <DialogDescription className="text-sm text-muted-foreground">
                                    Discover and add integrations to your AI assistant
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
                                className="h-8 px-3 text-sm font-medium hover:bg-muted whitespace-nowrap"
                            >
                                <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
                                Connect Custom
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => onClose()}
                                disabled={isCloseBlocked}
                            >
                                <X className="h-4 w-4" />
                                <span className="sr-only">Close</span>
                            </Button>
                        </div>
                    </div>
                </DialogHeader>

                {/* Theme: Clean search with subtle focus state and refined controls */}
                <div className="flex gap-3 mb-5 px-6 pt-5">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none z-10" />
                        <Input
                            placeholder="Search servers and integrations..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            className="pl-10 h-10 border focus:border-primary/40 bg-background text-sm placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-primary/20 transition-all"
                        />
                    </div>
                    <div className="flex bg-muted/50 rounded-md p-1 border">
                        <Button
                            variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={() => {
                                setViewMode('grid');
                                setExpandedEntry(null);
                            }}
                            className={cn(
                                'h-8 px-3 rounded-sm transition-all text-sm font-medium',
                                viewMode === 'grid'
                                    ? 'bg-background shadow-sm'
                                    : 'hover:bg-background/50'
                            )}
                        >
                            <Grid3X3 className="h-3.5 w-3.5 mr-1.5" />
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
                                'h-8 px-3 rounded-sm transition-all text-sm font-medium',
                                viewMode === 'list'
                                    ? 'bg-background shadow-sm'
                                    : 'hover:bg-background/50'
                            )}
                        >
                            <List className="h-3.5 w-3.5 mr-1.5" />
                            List
                        </Button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-6 pb-6">
                    {error && (
                        <Alert
                            variant="destructive"
                            className="mb-6 border-2 border-red-300 bg-red-50 shadow-md"
                        >
                            <AlertDescription className="text-red-800 font-medium">
                                {error}
                            </AlertDescription>
                        </Alert>
                    )}

                    {isLoading ? (
                        <div className="flex items-center justify-center py-24">
                            <div className="flex flex-col items-center space-y-5">
                                <div className="h-12 w-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                                <div className="text-lg text-foreground font-semibold">
                                    Discovering servers...
                                </div>
                                <div className="text-sm text-muted-foreground">
                                    Loading registry entries
                                </div>
                            </div>
                        </div>
                    ) : filteredEntries.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-24 text-center">
                            <div className="p-6 rounded-2xl bg-gradient-to-br from-muted/50 to-muted/30 border-2 border-border/30 mb-6 shadow-sm">
                                <Server className="h-14 w-14 text-muted-foreground/60 mx-auto" />
                            </div>
                            <div className="text-xl font-bold text-foreground mb-3">
                                {entries.length === 0
                                    ? 'No servers available in the registry'
                                    : 'No servers match your search'}
                            </div>
                            <div className="text-base text-muted-foreground/80 mb-6 max-w-md">
                                {entries.length === 0
                                    ? 'The registry is currently empty or failed to load'
                                    : 'Try adjusting your search terms or browse all categories'}
                            </div>
                            {searchInput && (
                                <Button
                                    variant="outline"
                                    onClick={() => setSearchInput('')}
                                    className="border-2 border-primary/30 hover:bg-primary/10 hover:border-primary/50 font-semibold"
                                >
                                    <Search className="h-4 w-4 mr-2" />
                                    Clear search
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div
                            className={cn(
                                viewMode === 'grid'
                                    ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6'
                                    : 'space-y-3'
                            )}
                        >
                            {filteredEntries.map((entry, index) => {
                                const isExpanded = expandedEntry === entry.id;
                                const hasLongDescription =
                                    entry.description && entry.description.length > 100;

                                return viewMode === 'grid' ? (
                                    <Card
                                        key={entry.id}
                                        className={cn(
                                            'group relative overflow-hidden transition-all duration-200 hover:-translate-y-0.5 border bg-card shadow-sm hover:shadow-lg hover:border-primary/30 flex flex-col',
                                            isExpanded &&
                                                'ring-1 ring-primary/20 border-primary/40 shadow-lg -translate-y-0.5'
                                        )}
                                        style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
                                    >
                                        <div
                                            className="cursor-pointer flex flex-col flex-1"
                                            onClick={() =>
                                                setExpandedEntry(isExpanded ? null : entry.id)
                                            }
                                        >
                                            {/* Theme: Balanced header with medium emphasis icon and refined typography */}
                                            <CardHeader className="pb-3 flex-shrink-0">
                                                <div className="flex items-start gap-3 mb-3">
                                                    <div className="relative flex-shrink-0">
                                                        <div className="text-2xl w-12 h-12 flex items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 group-hover:border-primary/30 transition-all duration-200">
                                                            {entry.icon || '⚡'}
                                                        </div>
                                                        {entry.isInstalled && (
                                                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-card flex items-center justify-center">
                                                                <CheckCircle className="h-2.5 w-2.5 text-white" />
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <CardTitle className="text-base font-semibold mb-2 group-hover:text-primary transition-colors leading-snug line-clamp-2">
                                                            {entry.name}
                                                        </CardTitle>
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            {entry.isOfficial && (
                                                                <Badge
                                                                    variant="outline"
                                                                    className="text-xs px-1.5 py-0 bg-blue-50 text-blue-700 border-blue-200/60 font-medium"
                                                                >
                                                                    <Star className="h-2.5 w-2.5 mr-1 fill-blue-400 text-blue-400" />
                                                                    Official
                                                                </Badge>
                                                            )}
                                                            {entry.category && (
                                                                <Badge
                                                                    variant="outline"
                                                                    className={cn(
                                                                        'text-xs px-1.5 py-0 font-medium capitalize',
                                                                        getCategoryColor(
                                                                            entry.category
                                                                        )
                                                                    )}
                                                                >
                                                                    {entry.category}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </CardHeader>
                                            <CardContent className="pt-0 flex flex-col flex-1">
                                                <div className="flex-1">
                                                    {/* Theme: Readable description with proper line height */}
                                                    <p
                                                        className={cn(
                                                            'text-sm text-muted-foreground leading-relaxed transition-all duration-200',
                                                            isExpanded ? '' : 'line-clamp-3'
                                                        )}
                                                    >
                                                        {entry.description}
                                                    </p>

                                                    {isExpanded && (
                                                        <div className="space-y-3 pt-3 mt-3 border-t border-border/30 animate-in slide-in-from-top-1 duration-200">
                                                            {entry.author && (
                                                                <div className="flex items-center gap-2 text-xs">
                                                                    <div className="p-1 rounded bg-muted/40">
                                                                        <Users className="h-3 w-3 text-muted-foreground" />
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-muted-foreground/70">
                                                                            by{' '}
                                                                        </span>
                                                                        <span className="font-medium text-foreground">
                                                                            {entry.author}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {entry.tags &&
                                                                entry.tags.length > 0 && (
                                                                    <div className="flex flex-wrap gap-1">
                                                                        {entry.tags
                                                                            .slice(0, 6)
                                                                            .map((tag) => (
                                                                                <Badge
                                                                                    key={tag}
                                                                                    variant="outline"
                                                                                    className="text-xs px-1.5 py-0 text-muted-foreground border-border/40 bg-muted/20 font-normal"
                                                                                >
                                                                                    {tag}
                                                                                </Badge>
                                                                            ))}
                                                                        {entry.tags.length > 6 && (
                                                                            <Badge
                                                                                variant="outline"
                                                                                className="text-xs px-1.5 py-0 text-muted-foreground border-border/40 bg-muted/20"
                                                                            >
                                                                                +
                                                                                {entry.tags.length -
                                                                                    6}
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                )}

                                                            {entry.homepage && (
                                                                <a
                                                                    href={entry.homepage}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
                                                                    onClick={(e) =>
                                                                        e.stopPropagation()
                                                                    }
                                                                >
                                                                    <ExternalLink className="h-3 w-3" />
                                                                    Documentation
                                                                </a>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Theme: Clean footer with primary CTA emphasis */}
                                                <div className="flex items-center justify-between pt-3 border-t border-border/30 flex-shrink-0 mt-auto">
                                                    {hasLongDescription && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="text-xs text-muted-foreground hover:text-foreground p-0 h-auto font-medium -ml-1"
                                                        >
                                                            {isExpanded ? (
                                                                <>
                                                                    <ChevronUp className="h-3 w-3 mr-1" />
                                                                    Less
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <ChevronDown className="h-3 w-3 mr-1" />
                                                                    More
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
                                                            disabled={
                                                                entry.isInstalled ||
                                                                installing === entry.id
                                                            }
                                                            size="sm"
                                                            variant={
                                                                entry.isInstalled
                                                                    ? 'outline'
                                                                    : 'default'
                                                            }
                                                            className={cn(
                                                                'h-8 px-4 transition-all font-semibold text-sm shadow-sm',
                                                                installing === entry.id &&
                                                                    'opacity-70',
                                                                entry.isInstalled &&
                                                                    'border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
                                                                !entry.isInstalled &&
                                                                    'bg-primary hover:bg-primary/90'
                                                            )}
                                                        >
                                                            {installing === entry.id ? (
                                                                <div className="flex items-center gap-1.5">
                                                                    <div className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                                                    <span>Adding</span>
                                                                </div>
                                                            ) : entry.isInstalled ? (
                                                                <div className="flex items-center gap-1.5">
                                                                    <CheckCircle className="h-3.5 w-3.5" />
                                                                    <span>Added</span>
                                                                </div>
                                                            ) : (
                                                                <div className="flex items-center gap-1.5">
                                                                    <Plus className="h-3.5 w-3.5" />
                                                                    <span>Add</span>
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
                                            'group transition-all duration-200 hover:-translate-y-0.5 border bg-card shadow-sm hover:shadow-md hover:border-primary/30 cursor-pointer !py-0 !gap-0',
                                            isExpanded &&
                                                'border-primary/40 shadow-md -translate-y-0.5'
                                        )}
                                        onClick={() =>
                                            setExpandedEntry(isExpanded ? null : entry.id)
                                        }
                                    >
                                        <div className="p-4">
                                            <div className="flex items-start gap-4">
                                                <div className="relative flex-shrink-0">
                                                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 group-hover:border-primary/30 flex items-center justify-center text-2xl transition-all duration-200">
                                                        {entry.icon || '⚡'}
                                                    </div>
                                                    {entry.isInstalled && (
                                                        <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-card flex items-center justify-center">
                                                            <CheckCircle className="h-2.5 w-2.5 text-white" />
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex-1 min-w-0 space-y-2.5">
                                                    <div className="flex items-start justify-between gap-4">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 mb-1.5">
                                                                <h3 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors leading-snug">
                                                                    {entry.name}
                                                                </h3>
                                                                {hasLongDescription && (
                                                                    <ChevronDown
                                                                        className={cn(
                                                                            'h-3.5 w-3.5 text-muted-foreground/60 transition-all duration-200 flex-shrink-0',
                                                                            isExpanded &&
                                                                                'rotate-180 text-muted-foreground'
                                                                        )}
                                                                    />
                                                                )}
                                                            </div>

                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                {entry.isOfficial && (
                                                                    <Badge
                                                                        variant="outline"
                                                                        className="text-xs px-1.5 py-0 bg-blue-50 text-blue-700 border-blue-200/60 font-medium"
                                                                    >
                                                                        <Star className="h-2.5 w-2.5 mr-1 fill-blue-400 text-blue-400" />
                                                                        Official
                                                                    </Badge>
                                                                )}
                                                                {entry.category && (
                                                                    <Badge
                                                                        variant="outline"
                                                                        className={cn(
                                                                            'text-xs px-1.5 py-0 font-medium capitalize',
                                                                            getCategoryColor(
                                                                                entry.category
                                                                            )
                                                                        )}
                                                                    >
                                                                        {entry.category}
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <Button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleInstall(entry);
                                                            }}
                                                            disabled={
                                                                entry.isInstalled ||
                                                                installing === entry.id
                                                            }
                                                            size="sm"
                                                            variant={
                                                                entry.isInstalled
                                                                    ? 'outline'
                                                                    : 'default'
                                                            }
                                                            className={cn(
                                                                'h-8 px-4 text-sm font-semibold transition-all flex-shrink-0 shadow-sm',
                                                                installing === entry.id &&
                                                                    'opacity-70',
                                                                entry.isInstalled &&
                                                                    'border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
                                                                !entry.isInstalled &&
                                                                    'bg-primary hover:bg-primary/90'
                                                            )}
                                                        >
                                                            {installing === entry.id ? (
                                                                <div className="flex items-center gap-1.5">
                                                                    <div className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                                                    <span>Adding</span>
                                                                </div>
                                                            ) : entry.isInstalled ? (
                                                                <div className="flex items-center gap-1.5">
                                                                    <CheckCircle className="h-3.5 w-3.5" />
                                                                    <span>Added</span>
                                                                </div>
                                                            ) : (
                                                                <div className="flex items-center gap-1.5">
                                                                    <Plus className="h-3.5 w-3.5" />
                                                                    <span>Add</span>
                                                                </div>
                                                            )}
                                                        </Button>
                                                    </div>

                                                    <div>
                                                        <p
                                                            className={cn(
                                                                'text-sm text-muted-foreground leading-relaxed transition-all duration-200',
                                                                isExpanded ? '' : 'line-clamp-2'
                                                            )}
                                                        >
                                                            {entry.description}
                                                        </p>
                                                    </div>

                                                    {isExpanded && (
                                                        <div className="space-y-3 pt-3 border-t border-border/30 animate-in slide-in-from-top-2 duration-200">
                                                            {entry.author && (
                                                                <div className="flex items-center gap-2 text-xs">
                                                                    <div className="p-1 rounded bg-muted/40">
                                                                        <Users className="h-3 w-3 text-muted-foreground" />
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-muted-foreground/70">
                                                                            by{' '}
                                                                        </span>
                                                                        <span className="font-medium text-foreground">
                                                                            {entry.author}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {entry.tags &&
                                                                entry.tags.length > 0 && (
                                                                    <div className="flex flex-wrap gap-1.5">
                                                                        {entry.tags.map((tag) => (
                                                                            <Badge
                                                                                key={tag}
                                                                                variant="outline"
                                                                                className="text-xs px-2 py-0.5 text-muted-foreground border-border/40 bg-muted/20 font-normal"
                                                                            >
                                                                                {tag}
                                                                            </Badge>
                                                                        ))}
                                                                    </div>
                                                                )}

                                                            {entry.homepage && (
                                                                <a
                                                                    href={entry.homepage}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
                                                                    onClick={(e) =>
                                                                        e.stopPropagation()
                                                                    }
                                                                >
                                                                    <ExternalLink className="h-3 w-3" />
                                                                    Documentation
                                                                </a>
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
