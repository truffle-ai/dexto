import { spawn } from 'child_process';
import { logger } from '@dexto/core';

// Default timeout for spawned processes (in milliseconds)
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Reusable helper to run any shell command with a timeout. Uses spawn to run the command.
 * @param command - The command to execute
 * @param args - The arguments to pass to the command
 * @param options - The options for the command
 * @returns A promise that resolves when the command has finished executing
 */
export function executeWithTimeout(
    command: string,
    args: string[],
    options: { cwd: string; timeoutMs?: number }
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const { cwd, timeoutMs: timeout = DEFAULT_TIMEOUT_MS } = options;
        const child = spawn(command, args, { cwd });
        let stdout = '';
        let stderr = '';

        // Kill process if it takes too long
        const timer = setTimeout(() => {
            logger.error(`Process timed out after ${timeout}ms, killing process`);
            child.kill();
            reject(new Error(`Process timed out after ${timeout}ms`));
        }, timeout);

        child.stdout.on('data', (data: Buffer) => {
            const text = data.toString();
            stdout += text;
            logger.debug(text);
        });

        child.stderr.on('data', (data: Buffer) => {
            const text = data.toString();
            stderr += text;
            // Not logging to avoid spamming the console with installation warnings
            // logger.error(text);
        });

        child.on('error', (error: Error) => {
            clearTimeout(timer);
            logger.error(`Error spawning process: ${error.message}`);
            reject(error);
        });

        child.on('close', (code: number) => {
            clearTimeout(timer);
            if (code !== 0) {
                logger.error(`Process exited with code ${code}\n${stderr}`);
                reject(new Error(`Process exited with code ${code}`));
            } else {
                logger.debug(`${command} ${args.join(' ')} stdout: ${stdout}`);
                resolve();
            }
        });
    });
}
