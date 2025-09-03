'use client';

import * as Switch from '@radix-ui/react-switch';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from './hooks/useTheme';
import { useState, useEffect } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

export function ThemeSwitch() {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = theme === 'dark';

  // Don't render switch until after hydration to avoid mismatch
  if (!mounted) {
    return (
      <div className="w-12 h-6 bg-gray-300 dark:bg-gray-700 rounded-full" />
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Switch.Root
            checked={isDark}
            onCheckedChange={toggleTheme}
            className="w-12 h-6 bg-gray-300 dark:bg-gray-700 rounded-full relative transition-colors flex items-center px-0.5"
            aria-label="Toggle theme"
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
        </TooltipTrigger>
        <TooltipContent>{isDark ? 'Switch to light mode' : 'Switch to dark mode'}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
