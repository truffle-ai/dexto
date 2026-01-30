import { useTheme } from '../../hooks/useTheme';
import { usePreferenceStore } from '@/lib/stores/preferenceStore';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { Moon, Sun, Zap } from 'lucide-react';

export function AppearanceSection() {
    const { theme, toggleTheme } = useTheme();
    const { isStreaming, setStreaming } = usePreferenceStore();

    return (
        <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
                Customize the look and feel of the application.
            </p>

            {/* Theme Setting */}
            <div className="space-y-4">
                <div className="flex items-center justify-between py-3 px-4 rounded-lg border border-border">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-md bg-muted">
                            {theme === 'dark' ? (
                                <Moon className="h-4 w-4" />
                            ) : (
                                <Sun className="h-4 w-4" />
                            )}
                        </div>
                        <div>
                            <Label className="text-sm font-medium">Dark Mode</Label>
                            <p className="text-sm text-muted-foreground">
                                Switch between light and dark themes
                            </p>
                        </div>
                    </div>
                    <Switch
                        checked={theme === 'dark'}
                        onCheckedChange={toggleTheme}
                        aria-label="Toggle dark mode"
                    />
                </div>

                {/* Streaming Setting */}
                <div className="flex items-center justify-between py-3 px-4 rounded-lg border border-border">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-md bg-muted">
                            <Zap className="h-4 w-4" />
                        </div>
                        <div>
                            <Label className="text-sm font-medium">Streaming Responses</Label>
                            <p className="text-sm text-muted-foreground">
                                Show responses as they are generated (recommended)
                            </p>
                        </div>
                    </div>
                    <Switch
                        checked={isStreaming}
                        onCheckedChange={setStreaming}
                        aria-label="Toggle streaming mode"
                    />
                </div>
            </div>
        </div>
    );
}
