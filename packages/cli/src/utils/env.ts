import * as path from 'path';
import { homedir } from 'os';
import dotenv from 'dotenv';
import {
    getExecutionContext,
    ensureDextoGlobalDirectory,
    getDextoEnvPath,
} from '@dexto/agent-management';

/**
 * Multi-layer environment variable loading with context awareness.
 * Loads environment variables in priority order:
 * 1. Shell environment (highest priority)
 * 2. Project .env (if in dexto project)
 * 3. Global ~/.dexto/.env (fallback)
 *
 * @param startPath Starting directory for project detection
 * @returns Combined environment variables object
 */
export async function loadEnvironmentVariables(
    startPath: string = process.cwd()
): Promise<Record<string, string>> {
    const context = getExecutionContext(startPath);
    const env: Record<string, string> = {};

    const globalEnvPath = path.join(homedir(), '.dexto', '.env');
    try {
        const globalResult = dotenv.config({ path: globalEnvPath, processEnv: {} });
        if (globalResult.parsed) {
            Object.assign(env, globalResult.parsed);
        }
    } catch {
        // Global .env is optional, ignore errors
    }

    // Load .env from CWD if it exists (may differ from startPath)
    const cwdEnvPath = path.join(process.cwd(), '.env');
    try {
        const cwdResult = dotenv.config({ path: cwdEnvPath, processEnv: {} });
        if (cwdResult.parsed) {
            Object.assign(env, cwdResult.parsed);
        }
    } catch {
        // CWD .env is optional, ignore errors
    }

    // For dexto projects, also load from project root (may differ from CWD)
    if (context === 'dexto-source' || context === 'dexto-project') {
        const projectEnvPath = getDextoEnvPath(startPath);
        // Only load if different from cwdEnvPath to avoid double-loading
        if (projectEnvPath !== cwdEnvPath) {
            try {
                const projectResult = dotenv.config({ path: projectEnvPath, processEnv: {} });
                if (projectResult.parsed) {
                    Object.assign(env, projectResult.parsed);
                }
            } catch {
                // Project .env is optional, ignore errors
            }
        }
    }

    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && value !== '') {
            env[key] = value;
        }
    }

    return env;
}

/**
 * Apply layered environment loading to process.env.
 * This replaces the simple dotenv.config() with multi-layer loading.
 * Should be called at CLI startup before any schema validation.
 *
 * @param startPath Starting directory for project detection
 */
export async function applyLayeredEnvironmentLoading(
    startPath: string = process.cwd()
): Promise<void> {
    await ensureDextoGlobalDirectory();

    const layeredEnv = await loadEnvironmentVariables(startPath);
    Object.assign(process.env, layeredEnv);
}
