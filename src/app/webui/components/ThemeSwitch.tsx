import * as Switch from '@radix-ui/react-switch';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from './hooks/useTheme';

export function ThemeSwitch() {
  const { theme, toggleTheme } = useTheme();

  const isDark = theme === 'dark';

  return (
    <Switch.Root
      checked={isDark}
      onCheckedChange={toggleTheme}
      className="w-12 h-6 bg-gray-300 dark:bg-gray-700 rounded-full relative transition-colors flex items-center px-0.5"
      aria-label="Toggle dark mode"
    >
      <Switch.Thumb
        className={`
          w-5 h-5 rounded-full shadow flex items-center justify-center
          transition-transform transform
          translate-x-0.5 data-[state=checked]:translate-x-[1.375rem]
          bg-white dark:bg-gray-100
        `}
      >
        {isDark ? (
          <Moon className="w-3.5 h-3.5 text-gray-700" />
        ) : (
          <Sun className="w-3.5 h-3.5 text-yellow-500" />
        )}
      </Switch.Thumb>
    </Switch.Root>
  );
}
