import { Key, Volume2, Palette, X, ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type SettingsSection = 'api-keys' | 'voice' | 'appearance';

type SettingsNavigationProps = {
    activeSection: SettingsSection;
    onSectionChange: (section: SettingsSection) => void;
    onClose: () => void;
    variant?: 'desktop' | 'mobile';
};

const sections: { id: SettingsSection; label: string; icon: typeof Key }[] = [
    { id: 'api-keys', label: 'API Keys', icon: Key },
    { id: 'voice', label: 'Voice & TTS', icon: Volume2 },
    { id: 'appearance', label: 'Appearance', icon: Palette },
];

export function SettingsNavigation({
    activeSection,
    onSectionChange,
    onClose,
    variant = 'desktop',
}: SettingsNavigationProps) {
    if (variant === 'mobile') {
        const activeItem = sections.find((s) => s.id === activeSection);
        const ActiveIcon = activeItem?.icon || Key;

        return (
            <div className="flex items-center justify-between w-full">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="flex items-center gap-2">
                            <ActiveIcon className="h-4 w-4" />
                            <span>{activeItem?.label}</span>
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-48">
                        {sections.map((section) => {
                            const Icon = section.icon;
                            return (
                                <DropdownMenuItem
                                    key={section.id}
                                    onClick={() => onSectionChange(section.id)}
                                    className={cn(
                                        'flex items-center gap-2',
                                        activeSection === section.id && 'bg-accent'
                                    )}
                                >
                                    <Icon className="h-4 w-4" />
                                    <span>{section.label}</span>
                                </DropdownMenuItem>
                            );
                        })}
                    </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close settings">
                    <X className="h-4 w-4" />
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-4 py-4 border-b border-border">
                <h2 className="font-semibold">Settings</h2>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={onClose}
                    aria-label="Close settings"
                >
                    <X className="h-4 w-4" />
                </Button>
            </div>

            <nav className="flex-1 py-2">
                {sections.map((section) => {
                    const Icon = section.icon;
                    const isActive = activeSection === section.id;

                    return (
                        <button
                            type="button"
                            key={section.id}
                            onClick={() => onSectionChange(section.id)}
                            aria-current={isActive ? 'page' : undefined}
                            className={cn(
                                'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                                'hover:bg-accent hover:text-accent-foreground',
                                isActive
                                    ? 'bg-accent text-accent-foreground font-medium'
                                    : 'text-muted-foreground'
                            )}
                        >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span>{section.label}</span>
                        </button>
                    );
                })}
            </nav>
        </div>
    );
}
