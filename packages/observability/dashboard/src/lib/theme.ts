/**
 * Design system tokens and theme configuration
 */

export const colors = {
    // Primary brand colors
    brand: {
        50: '#eff6ff',
        100: '#dbeafe',
        200: '#bfdbfe',
        300: '#93c5fd',
        400: '#60a5fa',
        500: '#3b82f6',
        600: '#2563eb',
        700: '#1d4ed8',
        800: '#1e40af',
        900: '#1e3a8a',
    },

    // Agent colors (blue)
    agent: {
        light: '#60a5fa',
        DEFAULT: '#3b82f6',
        dark: '#2563eb',
        bg: '#eff6ff',
    },

    // LLM colors (green)
    llm: {
        light: '#4ade80',
        DEFAULT: '#22c55e',
        dark: '#16a34a',
        bg: '#f0fdf4',
    },

    // Tool colors (purple)
    tool: {
        light: '#a78bfa',
        DEFAULT: '#8b5cf6',
        dark: '#7c3aed',
        bg: '#faf5ff',
    },

    // Status colors
    status: {
        success: {
            light: '#4ade80',
            DEFAULT: '#22c55e',
            dark: '#16a34a',
            bg: '#f0fdf4',
        },
        error: {
            light: '#f87171',
            DEFAULT: '#ef4444',
            dark: '#dc2626',
            bg: '#fef2f2',
        },
        warning: {
            light: '#fbbf24',
            DEFAULT: '#f59e0b',
            dark: '#d97706',
            bg: '#fffbeb',
        },
        info: {
            light: '#60a5fa',
            DEFAULT: '#3b82f6',
            dark: '#2563eb',
            bg: '#eff6ff',
        },
    },

    // Grayscale
    gray: {
        50: '#f9fafb',
        100: '#f3f4f6',
        200: '#e5e7eb',
        300: '#d1d5db',
        400: '#9ca3af',
        500: '#6b7280',
        600: '#4b5563',
        700: '#374151',
        800: '#1f2937',
        900: '#111827',
    },
};

export const typography = {
    fonts: {
        sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        mono: '"Menlo", "Monaco", "Courier New", monospace',
    },

    sizes: {
        xs: '0.75rem', // 12px
        sm: '0.875rem', // 14px
        base: '1rem', // 16px
        lg: '1.125rem', // 18px
        xl: '1.25rem', // 20px
        '2xl': '1.5rem', // 24px
        '3xl': '1.875rem', // 30px
        '4xl': '2.25rem', // 36px
        '5xl': '3rem', // 48px
    },

    weights: {
        normal: 400,
        medium: 500,
        semibold: 600,
        bold: 700,
    },
};

export const spacing = {
    0: '0',
    1: '0.25rem', // 4px
    2: '0.5rem', // 8px
    3: '0.75rem', // 12px
    4: '1rem', // 16px
    5: '1.25rem', // 20px
    6: '1.5rem', // 24px
    8: '2rem', // 32px
    10: '2.5rem', // 40px
    12: '3rem', // 48px
    16: '4rem', // 64px
    20: '5rem', // 80px
    24: '6rem', // 96px
};

export const shadows = {
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
    '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
    inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
};

export const borderRadius = {
    none: '0',
    sm: '0.125rem', // 2px
    DEFAULT: '0.25rem', // 4px
    md: '0.375rem', // 6px
    lg: '0.5rem', // 8px
    xl: '0.75rem', // 12px
    '2xl': '1rem', // 16px
    full: '9999px',
};

export const animations = {
    duration: {
        fast: '150ms',
        normal: '300ms',
        slow: '500ms',
    },

    easing: {
        linear: 'linear',
        easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
        easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
        easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
        bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
    },
};

// Recharts theme colors
export const chartColors = {
    primary: colors.brand[500],
    secondary: colors.brand[300],
    success: colors.status.success.DEFAULT,
    error: colors.status.error.DEFAULT,
    warning: colors.status.warning.DEFAULT,
    info: colors.status.info.DEFAULT,

    agent: colors.agent.DEFAULT,
    llm: colors.llm.DEFAULT,
    tool: colors.tool.DEFAULT,

    // Multi-series colors
    series: [
        colors.brand[500],
        colors.llm.DEFAULT,
        colors.tool.DEFAULT,
        colors.status.warning.DEFAULT,
        colors.status.error.DEFAULT,
        colors.agent.DEFAULT,
    ],
};
