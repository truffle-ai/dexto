'use client';

import React from 'react';
import { Bot, ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

interface ModelOption {
  name: string;
  provider: string;
  model: string;
}

interface ModelSelectorProps {
  currentModel: ModelOption | null;
  isLoading: boolean;
  models: ModelOption[];
  onModelChange: (model: ModelOption) => void;
  className?: string;
}

export function ModelSelector({ 
  currentModel, 
  isLoading, 
  models, 
  onModelChange, 
  className 
}: ModelSelectorProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className={cn(
            "h-8 px-3 text-sm text-muted-foreground hover:text-foreground rounded-full",
            className
          )}
          disabled={isLoading}
        >
          <Bot className="h-3 w-3 mr-1.5" />
          <span className="hidden sm:inline">
            {isLoading
              ? '...'
              : (currentModel?.name ?? 'Select model')}
          </span>
          <ChevronDown className="h-3 w-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {models.map((model) => (
          <DropdownMenuItem 
            key={model.model}
            onClick={() => onModelChange(model)}
          >
            <Bot className="h-4 w-4 mr-2" />
            {model.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
