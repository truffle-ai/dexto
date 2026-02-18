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
    } catch {
        logger.debug(`${fileName} not found in the current directory.`);
        throw new FileNotFoundError(`${fileName} not found in the current directory.`);
    }
}

export class FileNotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FileNotFoundError';
    }
}
