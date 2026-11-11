import * as path from 'node:path';
import { DextoRuntimeError, ErrorScope, ErrorType } from '@dexto/core';
import { promises as fs } from 'node:fs';

/**
 * Keys must be plain variable names and values must be single-line once surrounding whitespace
 * is trimmed (a pasted key often ends with a newline). A value with an inner line break is
 * refused as a user error, so one update can never add another variable.
 */
function validateUpdates(requested: Record<string, string>): Record<string, string> {
    const updates: Record<string, string> = {};
    for (const [key, rawValue] of Object.entries(requested)) {
        if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
            throw new Error(`Invalid environment variable name: ${key}`);
        }
        const value = rawValue.trim();
        if (/[\r\n]/.test(value)) {
            throw new DextoRuntimeError(
                'env_value_multiline',
                ErrorScope.CONFIG,
                ErrorType.USER,
                `Environment variable ${key} must be a single line`
            );
        }
        updates[key] = value;
    }
    return updates;
}

/**
 * Update a .env file with the provided key-value pairs.
 * Existing keys are updated in place, new keys are appended. Values are trimmed and must be
 * single-line. The file holds secrets, so it is kept readable by its owner only.
 */
export async function updateEnvFile(
    envFilePath: string,
    requested: Record<string, string>
): Promise<void> {
    const updates = validateUpdates(requested);

    await fs.mkdir(path.dirname(envFilePath), { recursive: true });

    let content = '';
    try {
        content = await fs.readFile(envFilePath, 'utf8');
    } catch {
        // File doesn't exist yet
    }

    const lines = content.split('\n');
    const updatedKeys = new Set<string>();

    // Update existing keys in place
    const updatedLines = lines.map((line) => {
        const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (match && match[1] && match[1] in updates) {
            const key = match[1];
            updatedKeys.add(key);
            return `${key}=${updates[key]}`;
        }
        return line;
    });

    // Append new keys that weren't found
    for (const [key, value] of Object.entries(updates)) {
        if (!updatedKeys.has(key)) {
            // Ensure there's a newline before appending
            if (updatedLines.length > 0 && updatedLines[updatedLines.length - 1] !== '') {
                updatedLines.push('');
            }
            updatedLines.push(`${key}=${value}`);
        }
    }

    // Ensure file ends with newline
    if (updatedLines[updatedLines.length - 1] !== '') {
        updatedLines.push('');
    }

    await fs.writeFile(envFilePath, updatedLines.join('\n'), { encoding: 'utf8', mode: 0o600 });
    // The mode above only applies when the file is created.
    await fs.chmod(envFilePath, 0o600);
}
