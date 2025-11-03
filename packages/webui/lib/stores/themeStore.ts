import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

type Theme = 'light' | 'dark';

interface ThemeStore {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    toggleTheme: (checked: boolean) => void;
}

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            theme: 'dark', // Default theme

            setTheme: (theme) => set({ theme }),

            toggleTheme: (checked) => set({ theme: checked ? 'dark' : 'light' }),
        }),
        {
            name: 'theme',
            storage: createJSONStorage(() => localStorage),
        }
    )
);

// Sync theme to DOM class and cookie when it changes
if (typeof window !== 'undefined') {
    useThemeStore.subscribe((state) => {
        const { theme } = state;
        document.documentElement.classList.toggle('dark', theme === 'dark');

        try {
            const isSecure = window.location?.protocol === 'https:';
            document.cookie = `theme=${encodeURIComponent(theme)}; path=/; max-age=31536000; SameSite=Lax${isSecure ? '; Secure' : ''}`;
        } catch {
            // Ignore cookie errors in restrictive environments
        }
    });
}
