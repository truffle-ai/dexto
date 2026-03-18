export const DEXTO_USAGE_SCOPE_ID_ENV = 'DEXTO_USAGE_SCOPE_ID';

export function getConfiguredUsageScopeId(): string | undefined {
    const value = process.env[DEXTO_USAGE_SCOPE_ID_ENV];
    if (!value) {
        return undefined;
    }

    const trimmedValue = value.trim();
    return trimmedValue.length > 0 ? trimmedValue : undefined;
}
