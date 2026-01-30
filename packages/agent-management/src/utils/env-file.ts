import * as path from 'node:path';
import { promises as fs } from 'node:fs';

/**
 * Update a .env file with the provided key-value pairs.
 * Existing keys are updated in place, new keys are appended.
 */
export async function updateEnvFile(
    envFilePath: string,
    updates: Record<string, string>
): Promise<void> {
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

    await fs.writeFile(envFilePath, updatedLines.join('\n'), 'utf8');
}
