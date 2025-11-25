'use client';

import React, { useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

type Props = {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    autoFocus?: boolean;
};

export function SearchBar({
    value,
    onChange,
    placeholder = 'Search models...',
    autoFocus = true,
}: Props) {
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (autoFocus && inputRef.current) {
            setTimeout(() => {
                inputRef.current?.focus();
            }, 100);
        }
    }, [autoFocus]);

    return (
        <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
                ref={inputRef}
                type="text"
                placeholder={placeholder}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className={cn(
                    'w-full h-11 pl-10 pr-10 rounded-xl',
                    'bg-muted/50 border border-border/50',
                    'text-sm placeholder:text-muted-foreground/70',
                    'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50',
                    'transition-all duration-200'
                )}
            />
            {value && (
                <button
                    onClick={() => onChange('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-accent transition-colors"
                    aria-label="Clear search"
                >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
            )}
        </div>
    );
}
