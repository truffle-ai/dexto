// packages/cli/src/cli/utils/supabase-client.ts

import { getAuthToken } from '../commands/auth.js';
import { logger } from '@dexto/core';

/**
 * Simple Supabase REST API client for CLI
 */
export class SupabaseClient {
    private supabaseUrl: string;
    private supabaseAnonKey: string;

    constructor() {
        this.supabaseUrl = process.env.SUPABASE_URL || '';
        this.supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

        if (!this.supabaseUrl || !this.supabaseAnonKey) {
            throw new Error(
                'SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required'
            );
        }
    }

    /**
     * Get authenticated user info
     */
    async getCurrentUser(): Promise<any> {
        const token = await getAuthToken();
        if (!token) {
            throw new Error('No authentication token found');
        }

        const response = await fetch(`${this.supabaseUrl}/auth/v1/user`, {
            headers: {
                Authorization: `Bearer ${token}`,
                apikey: this.supabaseAnonKey,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to get user: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Query a table with optional filters
     */
    async from(table: string) {
        const token = await getAuthToken();
        if (!token) {
            throw new Error('No authentication token found');
        }

        return {
            select: async (
                columns = '*',
                options: { eq?: Record<string, any>; limit?: number } = {}
            ) => {
                let url = `${this.supabaseUrl}/rest/v1/${table}?select=${columns}`;

                // Add filters
                if (options.eq) {
                    for (const [key, value] of Object.entries(options.eq)) {
                        url += `&${key}=eq.${value}`;
                    }
                }

                if (options.limit) {
                    url += `&limit=${options.limit}`;
                }

                const response = await fetch(url, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        apikey: this.supabaseAnonKey,
                    },
                });

                if (!response.ok) {
                    throw new Error(`Query failed: ${response.statusText}`);
                }

                return response.json();
            },

            insert: async (data: any) => {
                const response = await fetch(`${this.supabaseUrl}/rest/v1/${table}`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        apikey: this.supabaseAnonKey,
                        'Content-Type': 'application/json',
                        Prefer: 'return=representation',
                    },
                    body: JSON.stringify(data),
                });

                if (!response.ok) {
                    throw new Error(`Insert failed: ${response.statusText}`);
                }

                return response.json();
            },

            update: async (data: any, where: Record<string, any>) => {
                let url = `${this.supabaseUrl}/rest/v1/${table}?`;

                // Add where conditions
                for (const [key, value] of Object.entries(where)) {
                    url += `${key}=eq.${value}&`;
                }

                url = url.slice(0, -1); // Remove trailing &

                const response = await fetch(url, {
                    method: 'PATCH',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        apikey: this.supabaseAnonKey,
                        'Content-Type': 'application/json',
                        Prefer: 'return=representation',
                    },
                    body: JSON.stringify(data),
                });

                if (!response.ok) {
                    throw new Error(`Update failed: ${response.statusText}`);
                }

                return response.json();
            },

            delete: async (where: Record<string, any>) => {
                let url = `${this.supabaseUrl}/rest/v1/${table}?`;

                // Add where conditions
                for (const [key, value] of Object.entries(where)) {
                    url += `${key}=eq.${value}&`;
                }

                url = url.slice(0, -1); // Remove trailing &

                const response = await fetch(url, {
                    method: 'DELETE',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        apikey: this.supabaseAnonKey,
                    },
                });

                if (!response.ok) {
                    throw new Error(`Delete failed: ${response.statusText}`);
                }

                return response.json();
            },
        };
    }

    /**
     * Call a Supabase Edge Function
     */
    async callFunction(functionName: string, body: any = {}) {
        const token = await getAuthToken();
        if (!token) {
            throw new Error('No authentication token found');
        }

        const response = await fetch(`${this.supabaseUrl}/functions/v1/${functionName}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                apikey: this.supabaseAnonKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`Function call failed: ${response.statusText}`);
        }

        return response.json();
    }
}

// Export a singleton instance
export const supabase = new SupabaseClient();

/**
 * Helper function to require authentication and return user
 */
export async function requireAuthenticatedUser() {
    try {
        const user = await supabase.getCurrentUser();
        logger.debug(`Authenticated as: ${user.email}`);
        return user;
    } catch (_error) {
        console.error('❌ Authentication required. Run `dexto login` first.');
        process.exit(1);
    }
}
