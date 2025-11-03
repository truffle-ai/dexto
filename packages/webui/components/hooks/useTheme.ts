import { useThemeStore } from '@/lib/stores/themeStore';

export function useTheme() {
    const theme = useThemeStore((state) => state.theme);
    const toggleTheme = useThemeStore((state) => state.toggleTheme);

    // Keep API shape backward-compatible
    return { theme, toggleTheme, hasMounted: true } as const;
}
