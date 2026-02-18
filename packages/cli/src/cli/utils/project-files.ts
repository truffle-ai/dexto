import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '@dexto/core';

/**
 * Checks for a file in the current working directory.
 * Useful to decide if we are in the right folder of a valid project.
 */
export async function checkForFileInCurrentDirectory(fileName: string): Promise<void> {
    const filePath = path.join(process.cwd(), fileName);

    try {
        await fs.access(filePath);
    } catch (error: unknown) {
        const code =
            error && typeof error === 'object' && 'code' in error
                ? (error as { code?: unknown }).code
                : undefined;

        if (code === 'ENOENT') {
            logger.debug(`${fileName} not found in the current directory.`);
            throw new FileNotFoundError(`${fileName} not found in the current directory.`);
        }

        throw error;
    }
}

export class FileNotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FileNotFoundError';
    }
}
