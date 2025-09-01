'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { serverRegistry } from '@/lib/serverRegistry';
import type { ServerRegistryEntry, ServerRegistryFilter } from '@/types';
import AddCustomServerModal from './AddCustomServerModal';
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
    Download, 
    CheckCircle, 
    ExternalLink, 
    Star,
    Filter,
    Plus,
    Tag,
    Settings,
    Server
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ServerRegistryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onInstallServer: (entry: ServerRegistryEntry) => Promise<void>;
}

export default function ServerRegistryModal({ 
    isOpen, 
    onClose, 
    onInstallServer 
}: ServerRegistryModalProps) {
    const [entries, setEntries] = useState<ServerRegistryEntry[]>([]);
    const [filteredEntries, setFilteredEntries] = useState<ServerRegistryEntry[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [installing, setInstalling] = useState<string | null>(null);
    const [isAddCustomModalOpen, setIsAddCustomModalOpen] = useState(false);
    
    // Filter state
    const [filter, setFilter] = useState<ServerRegistryFilter>({});
    const [searchInput, setSearchInput] = useState('');
    
    // Ref for debouncing
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    
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
    }, [isOpen]);

    // Debounced filter function
    const debouncedApplyFilters = useCallback(async (currentFilter: ServerRegistryFilter, currentSearchInput: string) => {
        if (!isMountedRef.current) return;
        
        try {
            const filtered = await serverRegistry.getEntries({
                ...currentFilter,
                search: currentSearchInput || undefined,
            });
            
            if (isMountedRef.current) {
                setFilteredEntries(filtered);
            }
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

    const handleInstall = async (entry: ServerRegistryEntry) => {
        if (!isMountedRef.current) return;
        
        setInstalling(entry.id);
        try {
            await onInstallServer(entry);
            await serverRegistry.setInstalled(entry.id, true);
            
            // Update local state only if component is still mounted
            if (isMountedRef.current) {
                setEntries(prev => prev.map(e => 
                    e.id === entry.id ? { ...e, isInstalled: true } : e
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

    const handleAddCustomServer = async (entry: Omit<ServerRegistryEntry, 'id' | 'isOfficial' | 'lastUpdated'>) => {
        if (!isMountedRef.current) return;
        
        try {
            const newEntry = await serverRegistry.addCustomEntry(entry);
            
            if (isMountedRef.current) {
                setEntries(prev => [newEntry, ...prev]);
                setIsAddCustomModalOpen(false);
            }
        } catch (err: unknown) {
            if (isMountedRef.current) {
                const errorMessage = err instanceof Error ? err.message : 'Failed to add custom server';
                setError(errorMessage);
            }
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-2xl max-h-[70vh] overflow-hidden flex flex-col border-0 shadow-2xl">
                <DialogHeader className="pb-6">
                    <DialogTitle className="flex items-center gap-3 text-lg">
                        <div className="p-2 rounded-lg bg-primary/10">
                            <Server className="h-5 w-5 text-primary" />
                        </div>
                        Browse Tools
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        Discover and add new capabilities to your AI assistant
                    </DialogDescription>
                </DialogHeader>

                {/* Simple Search */}
                <div className="relative mb-6">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search for tools and integrations..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        className="pl-10 h-11 border-border/50 focus:border-primary/50 bg-background/50"
                    />
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto -mx-1 px-1">
                    {error && (
                        <Alert variant="destructive" className="mb-4">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="flex flex-col items-center space-y-3">
                                <div className="h-8 w-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                                <div className="text-sm text-muted-foreground">Discovering tools...</div>
                            </div>
                        </div>
                    ) : filteredEntries.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <div className="p-3 rounded-full bg-muted/50 mb-4">
                                <Server className="h-8 w-8 text-muted-foreground" />
                            </div>
                            <div className="text-muted-foreground">
                                {entries.length === 0 
                                    ? 'No tools available in the registry'
                                    : 'No tools match your search'
                                }
                            </div>
                            {searchInput && (
                                <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    onClick={() => setSearchInput('')}
                                    className="mt-2"
                                >
                                    Clear search
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredEntries.map((entry, index) => (
                                <div 
                                    key={entry.id} 
                                    className="group relative flex items-center justify-between p-4 border border-border/50 rounded-xl hover:border-border hover:shadow-sm bg-card/50 hover:bg-card transition-all duration-200"
                                    style={{ animationDelay: `${Math.min(index * 50, 500)}ms` }}
                                >
                                    <div className="flex items-center gap-4 flex-1 min-w-0">
                                        <div className="flex-shrink-0 text-2xl p-2 rounded-lg bg-primary/5 border border-primary/10">
                                            {entry.icon || '⚡'}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <h3 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors">
                                                    {entry.name}
                                                </h3>
                                                {entry.isOfficial && (
                                                    <Badge variant="secondary" className="text-xs font-medium px-2">
                                                        Official
                                                    </Badge>
                                                )}
                                                {entry.isInstalled && (
                                                    <Badge className="text-xs font-medium px-2 bg-green-100 text-green-800 border-green-200">
                                                        Added
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-sm text-muted-foreground line-clamp-1 leading-relaxed">
                                                {entry.description}
                                            </p>
                                        </div>
                                    </div>
                                    <Button
                                        onClick={() => handleInstall(entry)}
                                        disabled={entry.isInstalled || installing === entry.id}
                                        size="sm"
                                        variant={entry.isInstalled ? "outline" : "default"}
                                        className={cn(
                                            "flex-shrink-0 ml-3 min-w-[80px] transition-all",
                                            !entry.isInstalled && "hover:shadow-sm",
                                            installing === entry.id && "opacity-70"
                                        )}
                                    >
                                        {installing === entry.id ? (
                                            <div className="flex items-center gap-2">
                                                <div className="h-3 w-3 border border-current border-t-transparent rounded-full animate-spin" />
                                                <span>Adding...</span>
                                            </div>
                                        ) : entry.isInstalled ? (
                                            'Added'
                                        ) : (
                                            'Add'
                                        )}
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </DialogContent>

            {/* Add Custom Server Modal */}
            <AddCustomServerModal
                isOpen={isAddCustomModalOpen}
                onClose={() => setIsAddCustomModalOpen(false)}
                onAddServer={handleAddCustomServer}
            />
        </Dialog>
    );
} 