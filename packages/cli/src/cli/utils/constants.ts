// packages/cli/src/cli/utils/constants.ts

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
 */
export const SUPABASE_URL = 'https://cqsrkcnwlaknqildczld.supabase.co';
export const SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxc3JrY253bGFrbnFpbGRjemxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzMjQ2NzMsImV4cCI6MjA3NDkwMDY3M30.a-ZOh2PpQtn02DOUBL11eujsIUvkHdayQKoknshsz10';

/**
 * Dexto API URL for OpenRouter provisioning
 * Using stable production URL that always points to latest deployment
 */
export const DEXTO_API_URL = 'https://openrouter-keys.vercel.app';
