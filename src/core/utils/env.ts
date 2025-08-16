import * as path from 'path';
import { homedir } from 'os';
import { promises as fs } from 'fs';
import dotenv from 'dotenv';
import { getDextoProjectRoot, ensureDextoGlobalDirectory } from './path.js';

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
    const projectRoot = getDextoProjectRoot(startPath);
    const env: Record<string, string> = {};

    // Layer 3: Global ~/.dexto/.env (lowest priority)
    const globalEnvPath = path.join(homedir(), '.dexto', '.env');
    try {
        const globalResult = dotenv.config({ path: globalEnvPath, processEnv: {} });
        if (globalResult.parsed) {
            Object.assign(env, globalResult.parsed);
        }
    } catch {
        // Global .env is optional, ignore errors
    }

    // Layer 2: Project .env (medium priority)
    if (projectRoot) {
        const projectEnvPath = path.join(projectRoot, '.env');
        try {
            const projectResult = dotenv.config({ path: projectEnvPath, processEnv: {} });
            if (projectResult.parsed) {
                Object.assign(env, projectResult.parsed);
            }
        } catch {
            // Project .env is optional, ignore errors
        }
    }

    // Layer 1: Shell environment (highest priority)
    // Filter to only include defined values (not undefined)
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
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
    // Ensure global directory exists for saving later
    await ensureDextoGlobalDirectory();

    // Load layered environment and apply to process.env
    const layeredEnv = await loadEnvironmentVariables(startPath);
    Object.assign(process.env, layeredEnv);
}

/**
 * Core logic to update an .env file with Dexto environment variables.
 * This is the shared implementation used by both project and interactive env file updates.
 *
 * @param envFilePath - Absolute path to the .env file to update
 * @param updates - Object containing environment variable updates
 */
export async function updateEnvFile(
    envFilePath: string,
    updates: Record<string, string>
): Promise<void> {
    const dextoEnvKeys = [
        'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY',
        'GOOGLE_GENERATIVE_AI_API_KEY',
        'GROQ_API_KEY',
        'DEXTO_LOG_LEVEL',
    ];

    // Ensure directory exists (especially for global ~/.dexto/.env)
    await fs.mkdir(path.dirname(envFilePath), { recursive: true });

    // Read existing .env if present
    let envLines: string[] = [];
    try {
        const existingEnv = await fs.readFile(envFilePath, 'utf8');
        envLines = existingEnv.split('\n');
    } catch {
        // File may not exist, start with empty array
    }

    // Extract current values for Dexto environment variables
    const currentValues: Record<string, string> = {};
    envLines.forEach((line) => {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (match && match[1] && match[2] !== undefined && dextoEnvKeys.includes(match[1])) {
            currentValues[match[1]] = match[2];
        }
    });

    // Merge updates with current values
    const updatedValues: Record<string, string> = {
        OPENAI_API_KEY: updates.OPENAI_API_KEY ?? currentValues.OPENAI_API_KEY ?? '',
        ANTHROPIC_API_KEY: updates.ANTHROPIC_API_KEY ?? currentValues.ANTHROPIC_API_KEY ?? '',
        GOOGLE_GENERATIVE_AI_API_KEY:
            updates.GOOGLE_GENERATIVE_AI_API_KEY ??
            currentValues.GOOGLE_GENERATIVE_AI_API_KEY ??
            '',
        GROQ_API_KEY: updates.GROQ_API_KEY ?? currentValues.GROQ_API_KEY ?? '',
        DEXTO_LOG_LEVEL: updates.DEXTO_LOG_LEVEL ?? currentValues.DEXTO_LOG_LEVEL ?? 'info',
    };

    // Extract content before and after the Dexto section
    const sectionHeader = '## Dexto env variables';
    const headerIndex = envLines.findIndex((line) => line.trim() === sectionHeader);

    let contentLines: string[];

    if (headerIndex !== -1) {
        // Extract lines before the section header
        const beforeSection = envLines.slice(0, headerIndex);

        // Find the end of the section
        let sectionEnd = headerIndex + 1;
        while (sectionEnd < envLines.length && envLines[sectionEnd]?.trim() !== '') {
            sectionEnd++;
        }

        // Skip the blank line after the section if present
        if (sectionEnd < envLines.length && envLines[sectionEnd]?.trim() === '') {
            sectionEnd++;
        }

        // Extract lines after the section
        const afterSection = envLines.slice(sectionEnd);

        // Combine sections
        contentLines = [...beforeSection, ...afterSection];
    } else {
        contentLines = envLines;
    }

    // Identify env variables already present outside the Dexto section
    const existingEnvVars: Record<string, string> = {};
    contentLines.forEach((line) => {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (match && match[1] && match[2] !== undefined && dextoEnvKeys.includes(match[1])) {
            existingEnvVars[match[1]] = match[2];
        }
    });

    // Ensure exactly one blank line before adding the new section
    if (contentLines.length > 0) {
        // If the last line is not blank, add a blank line
        if (contentLines[contentLines.length - 1]?.trim() !== '') {
            contentLines.push('');
        }
    } else {
        // If the file was empty, add a blank line at the start
        contentLines.push('');
    }

    // Add the section header
    contentLines.push(sectionHeader);

    // Add environment variables that should be included
    for (const key of dextoEnvKeys) {
        // Skip keys already present outside Dexto section (unless being updated)
        if (key in existingEnvVars && !(key in updates)) {
            continue;
        }
        contentLines.push(`${key}=${updatedValues[key]}`);
    }

    // End with a blank line
    contentLines.push('');

    // Write the updated content
    await fs.writeFile(envFilePath, contentLines.join('\n'), 'utf8');
}
