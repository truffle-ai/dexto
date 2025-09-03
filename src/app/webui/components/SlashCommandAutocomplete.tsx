'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Zap } from 'lucide-react';
import { Badge } from './ui/badge';
import type { PromptArgument, PromptInfo } from '@core/prompts/types.js';

// PromptItem component for rendering individual prompts
const PromptItem = ({ prompt, isSelected, onClick, dataIndex }: { 
  prompt: Prompt; 
  isSelected: boolean; 
  onClick: () => void; 
  dataIndex?: number;
}) => (
  <div
    className={`px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors ${
      isSelected ? 'bg-muted/40' : ''
    }`}
    onClick={onClick}
    data-index={dataIndex}
  >
    <div className="flex items-start gap-2">
              <div className="flex-shrink-0 mt-0.5">
          {prompt.source === 'mcp' ? (
            <Zap className="h-3 w-3 text-blue-400" />
          ) : prompt.source === 'starter' ? (
            <span className="text-xs">🚀</span>
          ) : (
            <Sparkles className="h-3 w-3 text-purple-400" />
          )}
        </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-xs text-foreground">
            /{prompt.name}
          </span>
          {prompt.source === 'mcp' && (
            <Badge variant="outline" className="text-xs px-1.5 py-0.5 h-4">
              MCP
            </Badge>
          )}
          {prompt.source === 'internal' && (
            <Badge variant="outline" className="text-xs px-1.5 py-0.5 h-4">
              Internal
            </Badge>
          )}
          {prompt.source === 'starter' && (
            <Badge variant="outline" className="text-xs px-1.5 py-0.5 h-4 bg-primary/10 text-primary border-primary/20">
              Starter
            </Badge>
          )}
        </div>
        
        {/* Show title if available */}
        {prompt.title && (
          <div className="text-xs font-medium text-foreground/90 mb-0.5">
            {prompt.title}
          </div>
        )}
        
        {/* Show description if available and different from title */}
        {prompt.description && prompt.description !== prompt.title && (
          <div className="text-xs text-muted-foreground mb-1.5 line-clamp-2">
            {prompt.description}
          </div>
        )}
        
        {prompt.arguments && prompt.arguments.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {prompt.arguments.map((arg) => (
              <Badge 
                key={arg.name} 
                variant="secondary" 
                className="text-xs px-1.5 py-0.5 h-4 bg-muted/60 text-muted-foreground"
              >
                {arg.name}{arg.required ? '*' : ''}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  </div>
);

// Define UI-specific Prompt interface extending core PromptInfo
interface Prompt extends PromptInfo {
  // UI-specific fields that may come from metadata
  starterPrompt?: boolean;
  category?: string;
  icon?: string;
  priority?: number;
}

interface SlashCommandAutocompleteProps {
  isVisible: boolean;
  searchQuery: string;
  onSelectPrompt: (prompt: Prompt) => void;
  onClose: () => void;
}

export default function SlashCommandAutocomplete({ 
  isVisible, 
  searchQuery,
  onSelectPrompt, 
  onClose 
}: SlashCommandAutocompleteProps) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [filteredPrompts, setFilteredPrompts] = useState<Prompt[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Group prompts by source and category
  const groupedPrompts = React.useMemo(() => {
    const groups = {
      starter: prompts.filter(p => p.source === 'starter'),
      internal: prompts.filter(p => p.source === 'internal'),
      mcp: prompts.filter(p => p.source === 'mcp')
    };
    return groups;
  }, [prompts]);

  // Fetch available prompts
  useEffect(() => {
    if (!isVisible) return;

    const fetchPrompts = async () => {
      setIsLoading(true);
      try {
        const response = await fetch('/api/prompts');
        if (response.ok) {
          const data = await response.json();
          setPrompts(data.prompts || []);
          setFilteredPrompts(data.prompts || []);
        }
      } catch (error) {
        console.error('Failed to fetch prompts:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPrompts();
  }, [isVisible]);

  // Filter prompts based on search query from parent input
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery === '/') {
      setFilteredPrompts(prompts);
      setSelectedIndex(0);
      return;
    }

    // Remove the leading "/" for filtering
    const query = searchQuery.startsWith('/') ? searchQuery.slice(1) : searchQuery;
    
    const filtered = prompts.filter(prompt => 
      prompt.name.toLowerCase().includes(query.toLowerCase()) ||
      (prompt.description && prompt.description.toLowerCase().includes(query.toLowerCase())) ||
      (prompt.title && prompt.title.toLowerCase().includes(query.toLowerCase()))
    );
    
    setFilteredPrompts(filtered);
    setSelectedIndex(0);
  }, [searchQuery, prompts]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => 
            prev < filteredPrompts.length - 1 ? prev + 1 : 0
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => 
            prev > 0 ? prev - 1 : filteredPrompts.length - 1
          );
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredPrompts[selectedIndex]) {
            onSelectPrompt(filteredPrompts[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'Tab':
          e.preventDefault();
          if (filteredPrompts[selectedIndex]) {
            onSelectPrompt(filteredPrompts[selectedIndex]);
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, filteredPrompts, selectedIndex, onSelectPrompt, onClose]);

  // Scroll selected item into view when selectedIndex changes
  useEffect(() => {
    if (!scrollContainerRef.current) return;

    const scrollContainer = scrollContainerRef.current;
    const selectedItem = scrollContainer.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement;
    
    if (selectedItem) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const itemRect = selectedItem.getBoundingClientRect();
      
      // Check if item is visible in container
      const isAbove = itemRect.top < containerRect.top;
      const isBelow = itemRect.bottom > containerRect.bottom;
      
      if (isAbove || isBelow) {
        selectedItem.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        });
      }
    }
  }, [selectedIndex]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isVisible, onClose]);

  if (!isVisible || filteredPrompts.length === 0) return null;

  console.log('🔍 Rendering SlashCommandAutocomplete:', { 
    isVisible, 
    searchQuery,
    promptsCount: prompts.length, 
    filteredCount: filteredPrompts.length 
  });

  return (
    <div 
      ref={containerRef}
      className="absolute left-0 right-0 mb-2 bg-background border border-border rounded-lg shadow-lg max-h-96 overflow-hidden z-[9999]"
      style={{ 
        position: 'absolute',
        bottom: 'calc(100% + 84px)', // Position well above input to prevent overlap
        left: 0,
        right: 0,
        borderRadius: '8px',
        maxHeight: '320px',
        overflow: 'visible',
        zIndex: 9999,
        minWidth: '400px',
        // Custom dark styling
        background: 'linear-gradient(135deg, hsl(var(--background)) 0%, hsl(var(--muted)) 100%)',
        border: '1px solid hsl(var(--border) / 0.3)',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05)'
      }}
    >
      {/* Header - Compact with prompt count */}
      <div className="px-3 py-2 border-b border-border bg-muted/50">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span>Available Prompts</span>
          <Badge variant="secondary" className="ml-auto text-xs px-2 py-0.5">
            {filteredPrompts.length}
          </Badge>
        </div>
      </div>

      {/* Prompts List */}
      <div ref={scrollContainerRef} className="max-h-48 overflow-y-auto">
        {isLoading ? (
          <div className="p-3 text-center text-xs text-muted-foreground">
            Loading prompts...
          </div>
        ) : (
          <>
            {filteredPrompts.map((prompt, index) => (
              <PromptItem 
                key={prompt.name}
                prompt={prompt}
                isSelected={index === selectedIndex}
                onClick={() => onSelectPrompt(prompt)}
                dataIndex={index}
              />
            ))}
          </>
        )}
      </div>

      {/* Footer - Compact with navigation hints */}
      <div className="px-2 py-1.5 border-t border-border bg-muted/20 text-xs text-muted-foreground text-center">
        <span>↑↓ Navigate • Tab/Enter Select • Esc Close</span>
      </div>
    </div>
  );
}
