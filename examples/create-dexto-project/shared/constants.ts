/**
 * Shared Constants
 *
 * Define project-wide constants here.
 * This makes it easy to update values in one place.
 */

export const PROJECT = {
    NAME: 'Supabase Storage Distribution',
    VERSION: '1.0.0',
    DESCRIPTION: 'A Dexto distribution with Supabase blob storage and datetime utilities',
} as const;

export const DEFAULTS = {
    TIMEZONE: 'America/New_York',
    MAX_FILE_SIZE: 52428800, // 50MB
    MAX_TOTAL_SIZE: 1073741824, // 1GB
    CLEANUP_AFTER_DAYS: 30,
} as const;

export const PROVIDERS = {
    BLOB_STORAGE: {
        SUPABASE: 'supabase',
        LOCAL: 'local',
        MEMORY: 'memory',
    },
    TOOLS: {
        DATETIME_HELPER: 'datetime-helper',
    },
} as const;

export const ERRORS = {
    MISSING_ENV_VAR: 'Missing required environment variable',
    INVALID_CONFIG: 'Invalid configuration',
    PROVIDER_NOT_FOUND: 'Provider not found',
} as const;
