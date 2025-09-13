// packages/cli/src/cli/utils/auth-utils.ts

import { getAuthToken } from '../commands/auth.js';

/**
 * Add authentication headers to API requests
 */
export async function addAuthHeaders(
    headers: Record<string, string> = {}
): Promise<Record<string, string>> {
    const token = await getAuthToken();

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
}

/**
 * Make authenticated API request
 */
export async function authenticatedFetch(
    url: string,
    options: Parameters<typeof fetch>[1] = {}
): Promise<Awaited<ReturnType<typeof fetch>>> {
    const headers = await addAuthHeaders(options.headers as Record<string, string>);

    return fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...headers,
        },
    });
}

/**
 * Check if user is authenticated before running protected commands
 */
export async function requireAuth(): Promise<void> {
    const token = await getAuthToken();

    if (!token) {
        console.error('❌ Authentication required. Run `dexto login` first.');
        process.exit(1);
    }
}

/**
 * Example of a protected API call to your Supabase backend
 */
export async function callProtectedAPI(endpoint: string, data?: any): Promise<any> {
    await requireAuth();

    const apiUrl = process.env.DEXTO_API_URL || 'https://your-app.com';

    const fetchOptions: Parameters<typeof fetch>[1] = {
        method: data ? 'POST' : 'GET',
    };

    if (data) {
        fetchOptions.body = JSON.stringify(data);
    }

    const response = await authenticatedFetch(`${apiUrl}/api${endpoint}`, fetchOptions);

    if (!response.ok) {
        if (response.status === 401) {
            console.error(
                '❌ Authentication failed. Your token may have expired. Run `dexto login` again.'
            );
            process.exit(1);
        }

        throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
}
