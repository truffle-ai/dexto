import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ResourceMetadata } from '../components/types/resources.js';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Filter and sort resources by query, most recently modified first.
 * @param resources - Array of resource metadata
 * @param query - Search query string
 * @param limit - Maximum number of results (default: 25)
 * @returns Filtered and sorted array of resources
 */
export function filterAndSortResources(
    resources: ResourceMetadata[],
    query: string,
    limit: number = 25
): ResourceMetadata[] {
    const q = query.toLowerCase();
    const parseDate = (val?: string | Date): number => {
        if (!val) return 0;
        const time = new Date(val).getTime();
        return isNaN(time) ? 0 : time;
    };
    const sorted = [...resources].sort((a, b) => {
        const aTime = parseDate(a.lastModified);
        const bTime = parseDate(b.lastModified);
        return bTime - aTime;
    });
    return sorted
        .filter(
            (r) =>
                (r.name || '').toLowerCase().includes(q) ||
                r.uri.toLowerCase().includes(q) ||
                (r.serverName || '').toLowerCase().includes(q)
        )
        .slice(0, limit);
}
