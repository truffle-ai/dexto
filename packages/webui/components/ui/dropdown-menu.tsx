import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { cn } from '@/lib/utils';

// Mirror Popover Root props so consumers can control open state, etc.
const DropdownMenu = ({
    children,
    ...props
}: React.PropsWithChildren<React.ComponentProps<typeof PopoverPrimitive.Root>>) => (
    <Popover {...props}>{children}</Popover>
);

const DropdownMenuTrigger = PopoverTrigger;

const DropdownMenuContent = React.forwardRef<
    React.ElementRef<typeof PopoverContent>,
    React.ComponentPropsWithoutRef<typeof PopoverContent>
>(({ className, align = 'end', sideOffset = 8, ...props }, ref) => (
    <PopoverContent
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
            'z-50 min-w-[8rem] overflow-hidden rounded-xl bg-popover/95 backdrop-blur-xl p-1.5 text-popover-foreground',
            'border border-border/40 shadow-lg shadow-black/5',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
            className
        )}
        {...props}
    />
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

const DropdownMenuItem = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & {
        disabled?: boolean;
    }
>(({ className, disabled, ...props }, ref) => (
    <div
        ref={ref}
        className={cn(
            'relative flex cursor-default select-none items-center rounded-lg px-2.5 py-2 text-sm outline-none transition-all duration-150',
            'focus:bg-accent/60 focus:text-accent-foreground',
            disabled && 'pointer-events-none opacity-50',
            !disabled &&
                'hover:bg-accent/60 hover:text-accent-foreground cursor-pointer hover:scale-[0.98]',
            className
        )}
        {...props}
    />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

const DropdownMenuSeparator = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div ref={ref} className={cn('my-1.5 h-px bg-border/40', className)} {...props} />
));
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

export {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
};
