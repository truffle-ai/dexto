import * as path from 'node:path';
import { promises as fs } from 'node:fs';

/**
 * Update a .env file with the provided key-value pairs.
 * Existing keys are updated in place, new keys are appended.
 * Keys must be plain variable names and values must be single-line, so one update can never add
 * another variable. The file holds secrets, so it is kept readable by its owner only.
 */
export async function updateEnvFile(
    envFilePath: string,
    updates: Record<string, string>
): Promise<void> {
    for (const [key, value] of Object.entries(updates)) {
        if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
            throw new Error(`Invalid environment variable name: ${key}`);
        }
        if (/[\r\n]/.test(value)) {
            throw new Error(`Environment variable ${key} must be a single line`);
        }
    }

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
