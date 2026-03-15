const APP_URL_ENV_VAR = 'DEXTO_APP_URL';
const SANDBOX_URL_ENV_VAR = 'DEXTO_SANDBOX_URL';
const DEFAULT_APP_URL = 'https://app.dexto.ai';
const LOCAL_DASHBOARD_URL = 'http://localhost:5173';

function normalizeBaseUrl(value: string | undefined): string | null {
    const trimmed = value?.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const url = new URL(trimmed);
        url.pathname = '';
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/$/, '');
    } catch {
        return null;
    }
}

function isLocalHostUrl(value: string | undefined): boolean {
    const normalized = normalizeBaseUrl(value);
    if (!normalized) {
        return false;
    }

    const hostname = new URL(normalized).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function resolveDashboardBaseUrl(): string {
    const explicitAppUrl = normalizeBaseUrl(process.env[APP_URL_ENV_VAR]);
    if (explicitAppUrl) {
        return explicitAppUrl;
    }

    if (
        isLocalHostUrl(process.env[SANDBOX_URL_ENV_VAR]) ||
        isLocalHostUrl(process.env.DEXTO_API_URL)
    ) {
        return LOCAL_DASHBOARD_URL;
    }

    const normalizedApiUrl = normalizeBaseUrl(process.env.DEXTO_API_URL);
    if (normalizedApiUrl) {
        const apiUrl = new URL(normalizedApiUrl);
        if (apiUrl.hostname === 'api.dexto.ai') {
            return DEFAULT_APP_URL;
        }

        if (apiUrl.hostname.startsWith('api.')) {
            apiUrl.hostname = `app.${apiUrl.hostname.slice('api.'.length)}`;
            return apiUrl.toString().replace(/\/$/, '');
        }
    }

    return DEFAULT_APP_URL;
}

export function getCloudAgentDashboardUrl(cloudAgentId: string): string {
    return `${resolveDashboardBaseUrl()}/dashboard/cloud-agents/${encodeURIComponent(cloudAgentId)}`;
}
