'use client';

import React, { useEffect, useRef } from 'react';
import { Input } from '../ui/input';
import { Search } from 'lucide-react';

type Props = {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    autoFocus?: boolean;
};

export function SearchBar({
    value,
    onChange,
    placeholder = 'Search providers or models',
    autoFocus = false,
}: Props) {
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (autoFocus && inputRef.current) {
            // Use setTimeout to ensure the modal is fully rendered
            setTimeout(() => {
                inputRef.current?.focus();
            }, 100);
        }
    }, [autoFocus]);

    return (
        <div className="flex items-center gap-2 mb-4">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
                ref={inputRef}
                placeholder={placeholder}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
        </div>
    );
}
