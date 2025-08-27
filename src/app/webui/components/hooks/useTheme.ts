import { useEffect, useState } from 'react';

export function useTheme() {
    // Initialize from SSR-provided class on <html> to avoid flicker
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        if (typeof document !== 'undefined') {
            return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
        }
        // Match SSR default from layout (dark)
        return 'dark';
    });

    // Sync DOM class, localStorage and cookie when theme changes
    useEffect(() => {
        if (typeof document === 'undefined') return;
        document.documentElement.classList.toggle('dark', theme === 'dark');
        try {
            localStorage.setItem('theme', theme);
            document.cookie = `theme=${theme}; path=/; max-age=31536000`;
        } catch {}
    }, [theme]);

    const toggleTheme = (checked: boolean) => {
        setTheme(checked ? 'dark' : 'light');
    };

    // Keep API shape backward-compatible
    return { theme, toggleTheme, hasMounted: true } as const;
}
