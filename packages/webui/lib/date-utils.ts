/**
 * Date formatting utilities using native Intl API
 * Zero-bundle-cost alternative to date-fns
 *
 * Browser support: All modern browsers (2020+)
 */

/**
 * Format date in locale-specific format
 * @example formatDate(Date.now()) → "Nov 3, 2025"
 */
export function formatDate(timestamp: number, locale = 'en'): string {
    return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    }).format(timestamp);
}

/**
 * Format time in locale-specific format
 * @example formatTime(Date.now()) → "8:30 PM"
 */
export function formatTime(timestamp: number, locale = 'en'): string {
    return new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
    }).format(timestamp);
}

/**
 * Format date and time together
 * @example formatDateTime(Date.now()) → "Nov 3, 2025, 8:30 PM"
 */
export function formatDateTime(timestamp: number, locale = 'en'): string {
    return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(timestamp);
}

/**
 * Format relative time (e.g., "2 hours ago", "in 3 days")
 * @example formatRelativeTime(Date.now() - 7200000) → "2 hours ago"
 */
export function formatRelativeTime(timestamp: number, locale = 'en'): string {
    const now = Date.now();
    const diff = timestamp - now;
    const absDiff = Math.abs(diff);

    // Define time units in milliseconds
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const week = 7 * day;
    const month = 30 * day;
    const year = 365 * day;

    let value: number;
    let unit: Intl.RelativeTimeFormatUnit;

    if (absDiff < minute) {
        value = Math.round(diff / 1000);
        unit = 'second';
    } else if (absDiff < hour) {
        value = Math.round(diff / minute);
        unit = 'minute';
    } else if (absDiff < day) {
        value = Math.round(diff / hour);
        unit = 'hour';
    } else if (absDiff < week) {
        value = Math.round(diff / day);
        unit = 'day';
    } else if (absDiff < month) {
        value = Math.round(diff / week);
        unit = 'week';
    } else if (absDiff < year) {
        value = Math.round(diff / month);
        unit = 'month';
    } else {
        value = Math.round(diff / year);
        unit = 'year';
    }

    return new Intl.RelativeTimeFormat(locale, {
        numeric: 'auto',
    }).format(value, unit);
}

/**
 * Format date in ISO format (YYYY-MM-DD)
 * @example formatISO(Date.now()) → "2025-11-03"
 */
export function formatISO(timestamp: number): string {
    return new Date(timestamp).toISOString().split('T')[0];
}

/**
 * Format compact date (shorter format for space-constrained UI)
 * @example formatCompact(Date.now()) → "11/3/25"
 */
export function formatCompact(timestamp: number, locale = 'en'): string {
    return new Intl.DateTimeFormat(locale, {
        year: '2-digit',
        month: 'numeric',
        day: 'numeric',
    }).format(timestamp);
}
