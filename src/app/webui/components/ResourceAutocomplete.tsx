'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ResourceMetadata } from './hooks/useResources';
import { Scroll } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';

interface ResourceAutocompleteProps {
    resources: ResourceMetadata[];
    isOpen: boolean;
    position: { top: number; left: number };
    query: string;
    onSelect: (resource: ResourceMetadata) => void;
    onClose: () => void;
    selectedIndex: number;
    onKeyDown: (event: React.KeyboardEvent) => void;
}

export function ResourceAutocomplete({
    resources,
    isOpen,
    position,
    query,
    onSelect,
    onClose,
    selectedIndex,
    onKeyDown,
}: ResourceAutocompleteProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const selectedItemRef = useRef<HTMLDivElement>(null);

    // Filter resources based on query
    const filteredResources = resources.filter((resource) => {
        if (!query || query === '@') return true;
        
        const searchQuery = query.replace('@', '').toLowerCase();
        
        // Search in name, description, server name, and URI
        const searchFields = [
            resource.name,
            resource.description,
            resource.serverName,
            resource.uri,
        ].filter(Boolean);
        
        return searchFields.some((field) =>
            field?.toLowerCase().includes(searchQuery)
        );
    });

    // Limit to reasonable number of items for performance
    const displayedResources = filteredResources.slice(0, 20);
    
    // Ensure selectedIndex is within bounds
    const validSelectedIndex = Math.min(selectedIndex, displayedResources.length - 1);

    // Scroll selected item into view
    useEffect(() => {
        if (selectedItemRef.current && isOpen) {
            selectedItemRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
            });
        }
    }, [selectedIndex, isOpen]);

    // Handle clicks outside to close
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(event.target as Node)
            ) {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen, onClose]);

    if (!isOpen || displayedResources.length === 0) {
        return null;
    }

    const formatResourceReference = (resource: ResourceMetadata): string => {
        // Suggest the most user-friendly format
        if (resource.serverName && resource.name) {
            return `@${resource.serverName}:${resource.name}`;
        }
        if (resource.name) {
            return `@${resource.name}`;
        }
        // Fallback to full URI with brackets
        return `@<${resource.uri}>`;
    };

    const getResourceTypeIcon = (resource: ResourceMetadata): string => {
        if (resource.mimeType) {
            if (resource.mimeType.startsWith('text/')) return '📄';
            if (resource.mimeType.startsWith('application/json')) return '🔧';
            if (resource.mimeType.startsWith('image/')) return '🖼️';
            if (resource.mimeType.startsWith('audio/')) return '🎵';
            if (resource.mimeType.startsWith('video/')) return '🎥';
        }
        return '📁';
    };

    return (
        <div
            ref={containerRef}
            className="absolute z-[9999] w-72 bg-popover border border-border rounded-md shadow-lg overflow-hidden animate-in fade-in-0 slide-in-from-bottom-2 duration-150"
            style={{
                top: position.top,
                left: position.left,
                maxHeight: '200px',
                transform: 'translateZ(0)', // Force layer creation to prevent reflow
            }}
            onKeyDown={onKeyDown}
        >
            <div className="bg-muted/10 px-2 py-1 text-xs text-muted-foreground border-b">
                <div className="flex items-center gap-1">
                    <Scroll className="h-3 w-3" />
                    Resources ({displayedResources.length})
                </div>
            </div>
            
            <ScrollArea className="max-h-44">
                {displayedResources.map((resource, index) => (
                    <div
                        key={resource.uri}
                        ref={index === validSelectedIndex ? selectedItemRef : undefined}
                        className={`px-2 py-2 cursor-pointer border-b last:border-b-0 hover:bg-accent/50 transition-colors ${
                            index === validSelectedIndex ? 'bg-accent ring-1 ring-ring' : ''
                        }`}
                        onClick={() => onSelect(resource)}
                    >
                        <div className="flex items-start gap-1.5">
                            <span className="text-xs mt-0.5" aria-hidden="true">
                                {getResourceTypeIcon(resource)}
                            </span>
                            
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                    <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded text-primary">
                                        {formatResourceReference(resource)}
                                    </code>
                                    
                                    {resource.serverName && (
                                        <span className="inline-flex items-center px-1 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 rounded-full">
                                            {resource.serverName}
                                        </span>
                                    )}
                                </div>
                                
                                {resource.description && (
                                    <p className="text-xs text-muted-foreground line-clamp-1 leading-tight mb-1">
                                        {resource.description}
                                    </p>
                                )}
                                
                                <p className="text-xs text-muted-foreground/70 font-mono truncate">
                                    {resource.uri}
                                </p>
                            </div>
                        </div>
                    </div>
                ))}
            </ScrollArea>

            {displayedResources.length === 0 && query && query !== '@' && (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                        <Scroll className="h-6 w-6 opacity-50" />
                        <p>No resources found for "{query.replace('@', '')}"</p>
                        <p className="text-xs">Try a different search term</p>
                    </div>
                </div>
            )}
        </div>
    );
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}MB`;
    return `${Math.round(bytes / 1024 / 1024 / 1024)}GB`;
}