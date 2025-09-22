interface ErrorLike {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
}

/**
 * Resolve an HTTP status code from an error-like value.
 * Falls back to the provided default when no numeric status is present.
 */
export function resolveStatus(error: unknown, fallback = 500): number {
    if (error && typeof error === 'object') {
        const err = error as ErrorLike;

        if (typeof err.code === 'string' && err.code === 'VALIDATION_ERROR') {
            return 400;
        }

        if (typeof err.status === 'number') {
            return err.status;
        }

        if (typeof err.statusCode === 'number') {
            return err.statusCode;
        }
    }

    return fallback;
}

/**
 * Retrieve a human-friendly error message, ensuring a sensible fallback.
 */
export function resolveMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) {
        return error.message || fallback;
    }

    if (error && typeof error === 'object') {
        const err = error as ErrorLike;
        if (typeof err.message === 'string' && err.message.length > 0) {
            return err.message;
        }
    }

    return fallback;
}

/**
 * Convenience guard for checking an error's code without leaking implementation details.
 */
export function errorHasCode(error: unknown, code: string): boolean {
    return Boolean(error && typeof error === 'object' && (error as ErrorLike).code === code);
}

/**
 * Lightweight error normalizer inspired by core's toError utility.
 * Keeps the WebUI independent from @dexto/core runtime helpers.
 */
export function toAppError(error: unknown): Error {
    if (error instanceof Error) return error;

    if (error && typeof error === 'object') {
        const err = error as Record<string, unknown>;
        const candidates = ['message', 'error', 'details', 'description'] as const;
        for (const key of candidates) {
            const value = err[key];
            if (typeof value === 'string' && value.length > 0) {
                return new Error(value, { cause: error as unknown });
            }
        }

        try {
            return new Error(JSON.stringify(err));
        } catch {
            /* fall through */
        }
    }

    if (typeof error === 'string') {
        return new Error(error, { cause: error });
    }

    return new Error(String(error));
}
