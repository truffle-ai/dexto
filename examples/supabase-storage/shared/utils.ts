/**
 * Shared Utilities
 *
 * Common utilities used across your distribution.
 * This keeps your code DRY and maintainable.
 */

/**
 * Format a date for display
 */
export function formatDate(date: Date, timezone: string = 'UTC'): string {
    return date.toLocaleString('en-US', { timeZone: timezone });
}

/**
 * Validate environment variables
 */
export function validateEnv(requiredVars: string[]): void {
    const missing = requiredVars.filter((varName) => !process.env[varName]);

    if (missing.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missing.join(', ')}\n` +
                `Please check your .env file or environment configuration.`
        );
    }
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
    fn: () => Promise<T>,
    options: {
        maxAttempts?: number;
        initialDelay?: number;
        maxDelay?: number;
        backoffFactor?: number;
    } = {}
): Promise<T> {
    const { maxAttempts = 3, initialDelay = 1000, maxDelay = 10000, backoffFactor = 2 } = options;

    let lastError: Error | undefined;
    let delay = initialDelay;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;

            if (attempt < maxAttempts) {
                await sleep(Math.min(delay, maxDelay));
                delay *= backoffFactor;
            }
        }
    }

    throw new Error(
        `Failed after ${maxAttempts} attempts: ${lastError?.message || 'Unknown error'}`
    );
}
