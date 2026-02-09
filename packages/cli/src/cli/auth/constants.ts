// packages/cli/src/cli/auth/constants.ts

/**
 * Dexto's Supabase configuration for CLI authentication.
 *
 * SECURITY NOTE:
 * The Supabase anon key is safe to hardcode in distributed code because:
 * 1. It's designed for client-side use (web browsers, mobile apps, CLIs)
 * 2. It only grants anonymous access - real security is enforced by Row Level Security (RLS)
 * 3. This is standard practice (Vercel CLI, Supabase CLI, Firebase CLI all do the same)
 *
 * The service role key (which has admin access) is NEVER in this codebase.
 *
 * Environment variable overrides (for local development):
 * - SUPABASE_URL: Override Supabase URL (e.g., http://localhost:54321)
 * - SUPABASE_ANON_KEY: Override anon key (from `supabase start` output)
 * - DEXTO_API_URL: Override Dexto API URL (e.g., http://localhost:3001)
 */
export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gdfbxznhnnsamvsrtwjq.supabase.co';
export const SUPABASE_ANON_KEY =
    process.env.SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkZmJ4em5obm5zYW12c3J0d2pxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwNjkzNjksImV4cCI6MjA3OTY0NTM2OX0.j2NWOJDOy8gTT84XeomalkGSPpLdPvTCBnQMrTgdlI4';

/**
 * Dexto API URL for key provisioning
 */
export const DEXTO_API_URL = process.env.DEXTO_API_URL || 'https://api.dexto.ai';

/**
 * Dexto Nova credits purchase URL
 */
export const DEXTO_CREDITS_URL =
    process.env.DEXTO_CREDITS_URL || 'https://app.dexto.ai/dashboard/billing';
