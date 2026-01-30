import React from 'react';
import { cn } from '@/lib/utils';

interface FormSectionProps {
    title?: string;
    description?: string;
    children: React.ReactNode;
    className?: string;
}

interface FormGroupProps {
    children: React.ReactNode;
    className?: string;
}

interface FormRowProps {
    children: React.ReactNode;
    className?: string;
    columns?: 1 | 2 | 3;
}

/**
 * A card-like section for grouping related form fields.
 */
export function FormSection({ title, description, children, className }: FormSectionProps) {
    return (
        <div
            className={cn('bg-card rounded-lg border border-border p-4 shadow-minimal', className)}
        >
            {(title || description) && (
                <div className="mb-4">
                    {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
                    {description && (
                        <p className="text-xs text-muted-foreground mt-1">{description}</p>
                    )}
                </div>
            )}
            {children}
        </div>
    );
}

/**
 * A group of form fields with vertical spacing.
 */
export function FormGroup({ children, className }: FormGroupProps) {
    return <div className={cn('space-y-4', className)}>{children}</div>;
}

/**
 * A row for side-by-side form fields.
 */
export function FormRow({ children, className, columns = 2 }: FormRowProps) {
    const gridCols = {
        1: 'grid-cols-1',
        2: 'grid-cols-1 sm:grid-cols-2',
        3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    };

    return <div className={cn('grid gap-4', gridCols[columns], className)}>{children}</div>;
}

/**
 * A divider line between form sections.
 */
export function FormDivider({ className }: { className?: string }) {
    return <hr className={cn('border-t border-border my-4', className)} />;
}

/**
 * An alert/info box for important messages within forms.
 */
export function FormAlert({
    variant = 'info',
    children,
    className,
}: {
    variant?: 'info' | 'warning' | 'error' | 'success';
    children: React.ReactNode;
    className?: string;
}) {
    const variants = {
        info: 'bg-primary/5 border-primary/20 text-foreground',
        warning: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-700 dark:text-yellow-500',
        error: 'bg-destructive/10 border-destructive/20 text-destructive',
        success: 'bg-green-500/10 border-green-500/20 text-green-700 dark:text-green-500',
    };

    return (
        <div className={cn('rounded-lg border px-4 py-3 text-sm', variants[variant], className)}>
            {children}
        </div>
    );
}
