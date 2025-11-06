/**
 * Utility functions for the dashboard
 */

/**
 * Format large numbers with K/M/B suffixes
 */
export function formatNumber(num: number): string {
    if (num >= 1_000_000_000) {
        return `${(num / 1_000_000_000).toFixed(1)}B`;
    }
    if (num >= 1_000_000) {
        return `${(num / 1_000_000).toFixed(1)}M`;
    }
    if (num >= 1_000) {
        return `${(num / 1_000).toFixed(1)}K`;
    }
    return num.toString();
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    if (ms < 60000) {
        return `${(ms / 1000).toFixed(1)}s`;
    }
    if (ms < 3600000) {
        return `${(ms / 60000).toFixed(1)}m`;
    }
    return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Format timestamp to relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}d ago`;
    }
    if (hours > 0) {
        return `${hours}h ago`;
    }
    if (minutes > 0) {
        return `${minutes}m ago`;
    }
    return `${seconds}s ago`;
}

/**
 * Format percentage with specified decimal places
 */
export function formatPercent(value: number, decimals: number = 1): string {
    return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Generate sparkline data from time series
 */
export function generateSparklineData(
    traces: any[],
    timeWindow: number = 24 * 60 * 60 * 1000
): number[] {
    const now = Date.now();
    const buckets = 24; // 24 data points
    const bucketSize = timeWindow / buckets;
    const counts = new Array(buckets).fill(0);

    traces.forEach((trace) => {
        const age = now - trace.endTime;
        if (age < timeWindow) {
            const bucketIndex = Math.floor(age / bucketSize);
            if (bucketIndex >= 0 && bucketIndex < buckets) {
                counts[buckets - 1 - bucketIndex]++;
            }
        }
    });

    return counts;
}

/**
 * Calculate trend direction and value
 */
export function calculateTrend(
    current: number,
    previous: number
): { value: number; direction: 'up' | 'down' | 'neutral' } {
    if (previous === 0) {
        return { value: 0, direction: 'neutral' };
    }

    const change = ((current - previous) / previous) * 100;

    if (Math.abs(change) < 1) {
        return { value: 0, direction: 'neutral' };
    }

    return {
        value: Math.abs(change),
        direction: change > 0 ? 'up' : 'down',
    };
}

/**
 * Group array items by key
 */
export function groupBy<T>(array: T[], key: keyof T): Map<any, T[]> {
    return array.reduce((map, item) => {
        const keyValue = item[key];
        const group = map.get(keyValue) || [];
        group.push(item);
        map.set(keyValue, group);
        return map;
    }, new Map());
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | null = null;

    return (...args: Parameters<T>) => {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => func(...args), wait);
    };
}

/**
 * Class name merger (simple version)
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
    return classes.filter(Boolean).join(' ');
}
