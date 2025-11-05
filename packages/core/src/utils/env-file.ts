// TODO: (migration) This file is duplicated in @dexto/agent-management for short-term compatibility
// Remove from core once path utilities are fully migrated

import * as path from 'node:path';
import { promises as fs } from 'node:fs';

const DEXTO_ENV_KEYS = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'GROQ_API_KEY',
    'COHERE_API_KEY',
    'XAI_API_KEY',
    'DEXTO_LOG_LEVEL',
] as const;

type DextoEnvKey = (typeof DEXTO_ENV_KEYS)[number];

function isDextoEnvKey(value: string): value is DextoEnvKey {
    return (DEXTO_ENV_KEYS as readonly string[]).includes(value);
}

/**
 * Update a .env file with Dexto environment variables, ensuring our section stays consistent.
 */
export async function updateEnvFile(
    envFilePath: string,
    updates: Record<string, string>
): Promise<void> {
    await fs.mkdir(path.dirname(envFilePath), { recursive: true });

    let envLines: string[] = [];
    try {
        const existingEnv = await fs.readFile(envFilePath, 'utf8');
        envLines = existingEnv.split('\n');
    } catch {
        // File may not exist yet; start empty
    }

    const currentValues: Partial<Record<DextoEnvKey, string>> = {};
    envLines.forEach((line) => {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (match && match[1] && isDextoEnvKey(match[1])) {
            const value = match[2] ?? '';
            currentValues[match[1]] = value;
        }
    });

    const updatedValues = Object.fromEntries(
        DEXTO_ENV_KEYS.map((key) => {
            const update = updates[key];
            const current = currentValues[key];
            const fallback = key === 'DEXTO_LOG_LEVEL' ? 'info' : '';
            const value = update !== undefined ? update : (current ?? fallback);
            return [key, value];
        })
    ) as Record<DextoEnvKey, string>;

    const sectionHeader = '## Dexto env variables';
    const headerIndex = envLines.findIndex((line) => line.trim() === sectionHeader);

    let contentLines: string[];
    if (headerIndex !== -1) {
        const beforeSection = envLines.slice(0, headerIndex);

        let sectionEnd = headerIndex + 1;
        while (sectionEnd < envLines.length && envLines[sectionEnd]?.trim() !== '') {
            sectionEnd++;
        }
        if (sectionEnd < envLines.length && envLines[sectionEnd]?.trim() === '') {
            sectionEnd++;
        }

        const afterSection = envLines.slice(sectionEnd);
        contentLines = [...beforeSection, ...afterSection];
    } else {
        contentLines = envLines;
    }

    const existingEnvVars: Partial<Record<DextoEnvKey, string>> = {};
    contentLines.forEach((line) => {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (match && match[1] && isDextoEnvKey(match[1])) {
            const value = match[2] ?? '';
            existingEnvVars[match[1]] = value;
        }
    });

    if (contentLines.length > 0) {
        if (contentLines[contentLines.length - 1]?.trim() !== '') {
            contentLines.push('');
        }
    } else {
        contentLines.push('');
    }

    contentLines.push(sectionHeader);

    for (const key of DEXTO_ENV_KEYS) {
        if (key in existingEnvVars && !(key in updates)) {
            continue;
        }
        contentLines.push(`${key}=${updatedValues[key]}`);
    }

    contentLines.push('');

    await fs.writeFile(envFilePath, contentLines.join('\n'), 'utf8');
}
