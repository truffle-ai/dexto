import React from 'react';
import { cn } from '@/lib/utils';

interface TabsProps {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
    className?: string;
}

interface TabsListProps {
    children: React.ReactNode;
    className?: string;
}

interface TabsTriggerProps {
    value: string;
    children: React.ReactNode;
    className?: string;
    disabled?: boolean;
    icon?: React.ReactNode;
    badge?: React.ReactNode;
}

interface TabsContentProps {
    value: string;
    children: React.ReactNode;
    className?: string;
}

const TabsContext = React.createContext<{
    value: string;
    onValueChange: (value: string) => void;
} | null>(null);

function useTabsContext() {
    const context = React.useContext(TabsContext);
    if (!context) {
        throw new Error('Tabs components must be used within a Tabs provider');
    }
    return context;
}

export function Tabs({ value, onValueChange, children, className }: TabsProps) {
    return (
        <TabsContext.Provider value={{ value, onValueChange }}>
            <div className={cn('flex flex-col h-full', className)}>{children}</div>
        </TabsContext.Provider>
    );
}

export function TabsList({ children, className }: TabsListProps) {
    return (
        <div
            className={cn(
                'flex items-center gap-1 px-4 py-2 border-b border-border bg-muted/30',
                className
            )}
            role="tablist"
        >
            {children}
        </div>
    );
}

export function TabsTrigger({
    value,
    children,
    className,
    disabled,
    icon,
    badge,
}: TabsTriggerProps) {
    const { value: selectedValue, onValueChange } = useTabsContext();
    const isSelected = value === selectedValue;

    return (
        <button
            role="tab"
            aria-selected={isSelected}
            aria-disabled={disabled}
            disabled={disabled}
            onClick={() => onValueChange(value)}
            className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                isSelected
                    ? 'bg-background text-foreground shadow-sm border border-border/50'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                disabled && 'opacity-50 cursor-not-allowed',
                className
            )}
        >
            {icon && <span className="flex-shrink-0">{icon}</span>}
            <span>{children}</span>
            {badge}
        </button>
    );
}

export function TabsContent({ value, children, className }: TabsContentProps) {
    const { value: selectedValue } = useTabsContext();

    if (value !== selectedValue) {
        return null;
    }

    return (
        <div role="tabpanel" className={cn('flex-1 overflow-auto animate-fade-in', className)}>
            {children}
        </div>
    );
}
