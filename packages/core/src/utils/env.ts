const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export function isTruthyEnv(name: string): boolean {
    const value = process.env[name];
    if (!value) return false;
    return TRUE_VALUES.has(value.trim().toLowerCase());
}

export function readBooleanEnv(name: string, defaultValue: boolean): boolean {
    const value = process.env[name];
    if (value === undefined) return defaultValue;
    const normalized = value.trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    return defaultValue;
}

export function isBackgroundTasksEnabled(): boolean {
    return readBooleanEnv('DEXTO_BACKGROUND_TASKS_ENABLED', false);
}
