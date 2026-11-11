import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@dexto/core/logger';
import { ProcessService } from './process-service.js';
import { ProcessToolsConfigSchema } from './tool-factory-config.js';
import type { ProcessHandle } from './types.js';

function createLogger(): Logger {
    const logger = {
        createChild: () => logger,
        debug: () => {},
        error: () => {},
        info: () => {},
        warn: () => {},
    };
    return logger as unknown as Logger;
}

function createService(): ProcessService {
    const config = ProcessToolsConfigSchema.parse({
        type: 'process-tools',
        securityLevel: 'permissive',
        workingDirectory: process.cwd(),
    });
    return new ProcessService(
        {
            ...config,
            allowedCommands: [],
            blockedCommands: [],
            environment: {},
        },
        createLogger()
    );
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (!(await condition())) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

/**
 * Starts a background shell whose command starts a child process, and returns that child's pid.
 * The inner `sh` prints its own pid first, then runs `sleep`.
 */
async function startBackgroundWithChild(
    service: ProcessService,
    timeout?: number
): Promise<{ handle: ProcessHandle; childPid: number }> {
    const handle = (await service.executeCommand("sh -c 'echo $$; sleep 60'; echo done", {
        runInBackground: true,
        ...(timeout === undefined ? {} : { timeout }),
    })) as ProcessHandle;
    let stdout = '';
    await waitFor(async () => {
        stdout += (await service.getProcessOutput(handle.processId)).stdout;
        return /^\d+\n/.test(stdout);
    });
    const childPid = Number(stdout.split('\n')[0]);
    expect(isAlive(childPid)).toBe(true);
    return { handle, childPid };
}

describe.skipIf(process.platform === 'win32')('stopping background commands', () => {
    const pids: number[] = [];

    afterEach(() => {
        for (const pid of pids.splice(0)) {
            try {
                process.kill(pid, 'SIGKILL');
            } catch {
                // Already stopped.
            }
        }
        vi.restoreAllMocks();
    });

    it('killProcess stops the processes the command started', async () => {
        const service = createService();
        const { handle, childPid } = await startBackgroundWithChild(service);
        pids.push(childPid);

        await service.killProcess(handle.processId);

        await waitFor(() => !isAlive(childPid));
    });

    it('the background timeout stops the processes the command started', async () => {
        const service = createService();
        const { childPid } = await startBackgroundWithChild(service, 400);
        pids.push(childPid);

        await waitFor(() => !isAlive(childPid));
    });
});
