import { spawn, type ChildProcess } from 'node:child_process';

/** Output kept per stream; anything beyond is dropped. */
const MAX_OUTPUT_CHARS = 10 * 1024 * 1024;
/** How long a stopped command may take to exit after SIGTERM before it is killed outright. */
const KILL_GRACE_MS = 1000;
/** Exit code reported for a command stopped by the abort signal (SIGINT convention). */
const ABORTED_EXIT_CODE = 130;

export interface RunCommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut?: boolean;
}

/**
 * Run a shell command in its own process group. A timeout or abort stops the whole group, so
 * commands started by the shell stop too. Exits, including non-zero ones, are returned.
 */
export function runCommand(
    command: string,
    options: {
        cwd: string;
        env: Record<string, string>;
        timeout?: number;
        signal?: AbortSignal | undefined;
    }
): Promise<RunCommandResult> {
    const { cwd, env, timeout, signal } = options;
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            resolve({ exitCode: ABORTED_EXIT_CODE, stdout: '', stderr: '(Command was cancelled)' });
            return;
        }

        const child = spawn(command, {
            cwd,
            env,
            shell: true,
            detached: process.platform !== 'win32',
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let aborted = false;
        let killTimer: ReturnType<typeof setTimeout> | undefined;

        const stop = () => {
            signalProcessGroup(child, 'SIGTERM');
            killTimer ??= setTimeout(() => signalProcessGroup(child, 'SIGKILL'), KILL_GRACE_MS);
        };
        const timeoutTimer =
            timeout === undefined
                ? undefined
                : setTimeout(() => {
                      timedOut = true;
                      stop();
                  }, timeout);
        const onAbort = () => {
            aborted = true;
            stop();
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        const cleanUp = () => {
            clearTimeout(timeoutTimer);
            clearTimeout(killTimer);
            signal?.removeEventListener('abort', onAbort);
        };

        child.stdout?.on('data', (chunk: Buffer) => {
            stdout = appendCapped(stdout, chunk.toString());
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            stderr = appendCapped(stderr, chunk.toString());
        });
        child.once('error', (error) => {
            cleanUp();
            reject(error);
        });
        child.once('close', (code) => {
            // The shell may exit on SIGTERM while something it started ignores it and no longer
            // holds our pipes, so 'close' can fire before the escalation timer. Kill the group
            // now, because cleanUp cancels that timer.
            if (timedOut || aborted) signalProcessGroup(child, 'SIGKILL');
            cleanUp();
            if (aborted) {
                resolve({
                    exitCode: ABORTED_EXIT_CODE,
                    stdout: `${stdout}\n\n(Command was cancelled)`,
                    stderr,
                });
                return;
            }
            resolve({ exitCode: code ?? 1, stdout, stderr, ...(timedOut && { timedOut }) });
        });
    });
}

function appendCapped(current: string, chunk: string): string {
    return current.length >= MAX_OUTPUT_CHARS
        ? current
        : (current + chunk).slice(0, MAX_OUTPUT_CHARS);
}

function signalProcessGroup(child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL'): void {
    if (child.pid === undefined) return;
    if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
        return;
    }
    try {
        process.kill(-child.pid, signal);
    } catch {
        // The group is already gone.
    }
}
