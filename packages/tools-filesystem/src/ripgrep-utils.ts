import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { createInterface } from 'node:readline';

const STDERR_LIMIT = 8192;

let ripgrepAvailabilityPromise: Promise<boolean> | null = null;

type LineCollector = (line: string) => boolean | Promise<boolean>;

type RipgrepRunResult = {
    terminatedEarly: boolean;
    exitCode: number | null;
    stderr: string;
};

export type RipgrepMatch = {
    file: string;
    lineNumber: number;
    line: string;
};

type RipgrepJsonEvent = {
    type?: string;
    data?: {
        path?: {
            text?: string;
        };
        line_number?: number;
        lines?: {
            text?: string;
        };
    };
};

function appendStderr(current: string, chunk: string): string {
    const next = current + chunk;
    if (next.length <= STDERR_LIMIT) {
        return next;
    }
    return next.slice(0, STDERR_LIMIT);
}

async function runRipgrepLines(
    args: string[],
    options: {
        cwd: string;
        onLine: LineCollector;
    }
): Promise<RipgrepRunResult> {
    const child = spawn('rg', args, {
        cwd: options.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let exitCode: number | null = null;
    let terminatedEarly = false;

    child.stderr.on('data', (chunk: Buffer | string) => {
        stderr = appendStderr(stderr, chunk.toString());
    });

    const closePromise = new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code) => {
            exitCode = code;
            resolve();
        });
    });

    const rl = createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
    });

    try {
        for await (const line of rl) {
            if (!line) {
                continue;
            }

            const shouldContinue = await options.onLine(line);
            if (!shouldContinue) {
                terminatedEarly = true;
                child.kill();
                break;
            }
        }
    } finally {
        rl.close();
        child.stdout.destroy();
    }

    await closePromise;

    if (!terminatedEarly && exitCode !== 0 && exitCode !== 1) {
        const message = stderr.trim() || `ripgrep exited with code ${exitCode ?? 'unknown'}`;
        throw new Error(message);
    }

    return {
        terminatedEarly,
        exitCode,
        stderr,
    };
}

export async function isRipgrepAvailable(): Promise<boolean> {
    if (ripgrepAvailabilityPromise) {
        return ripgrepAvailabilityPromise;
    }

    ripgrepAvailabilityPromise = new Promise((resolve) => {
        const child = spawn('rg', ['--version'], {
            stdio: 'ignore',
        });

        child.once('error', () => resolve(false));
        child.once('close', (code) => resolve(code === 0));
    });

    return ripgrepAvailabilityPromise;
}

export async function ripgrepFiles(options: {
    cwd: string;
    globs?: string[];
    maxResults?: number;
}): Promise<{ paths: string[]; truncated: boolean } | null> {
    if (!(await isRipgrepAvailable())) {
        return null;
    }

    const limit = options.maxResults ?? Number.POSITIVE_INFINITY;
    const paths: string[] = [];

    const args = ['--files', '--hidden', '--glob=!.git/*'];
    for (const glob of options.globs ?? []) {
        args.push(`--glob=${glob}`);
    }

    const result = await runRipgrepLines(args, {
        cwd: options.cwd,
        onLine: (line) => {
            paths.push(path.resolve(options.cwd, line));
            return paths.length < limit;
        },
    });

    return {
        paths,
        truncated: result.terminatedEarly,
    };
}

export async function ripgrepWalkFiles(options: {
    cwd: string;
    globs?: string[];
    onPath: (absolutePath: string) => boolean | Promise<boolean>;
}): Promise<{ terminatedEarly: boolean } | null> {
    if (!(await isRipgrepAvailable())) {
        return null;
    }

    const args = ['--files', '--hidden', '--glob=!.git/*'];
    for (const glob of options.globs ?? []) {
        args.push(`--glob=${glob}`);
    }

    const result = await runRipgrepLines(args, {
        cwd: options.cwd,
        onLine: (line) => options.onPath(path.resolve(options.cwd, line)),
    });

    return {
        terminatedEarly: result.terminatedEarly,
    };
}

export async function ripgrepSearch(options: {
    cwd: string;
    pattern: string;
    globs?: string[];
    targetPath?: string;
    caseInsensitive?: boolean;
    literal?: boolean;
    maxResults?: number;
}): Promise<{ matches: RipgrepMatch[]; filesSearched: number; truncated: boolean } | null> {
    if (!(await isRipgrepAvailable())) {
        return null;
    }

    const limit = options.maxResults ?? Number.POSITIVE_INFINITY;
    const matches: RipgrepMatch[] = [];
    const files = new Set<string>();

    const args = ['--json', '--hidden', '--no-messages', '-n', '--glob=!.git/*'];
    if (options.caseInsensitive) {
        args.push('-i');
    }
    if (options.literal) {
        args.push('-F');
    } else {
        args.push('-P');
    }
    for (const glob of options.globs ?? []) {
        args.push(`--glob=${glob}`);
    }
    args.push('--', options.pattern);
    if (options.targetPath) {
        args.push(options.targetPath);
    }

    let result: RipgrepRunResult;
    try {
        result = await runRipgrepLines(args, {
            cwd: options.cwd,
            onLine: (line) => {
                let event: RipgrepJsonEvent;
                try {
                    event = JSON.parse(line) as RipgrepJsonEvent;
                } catch {
                    return true;
                }

                if (event.type === 'begin') {
                    const relativePath = event.data?.path?.text;
                    if (relativePath) {
                        files.add(path.resolve(options.cwd, relativePath));
                    }
                    return true;
                }

                if (event.type !== 'match') {
                    return true;
                }

                const relativePath = event.data?.path?.text;
                const lineNumber = event.data?.line_number;
                const lineText = event.data?.lines?.text;
                if (
                    !relativePath ||
                    typeof lineNumber !== 'number' ||
                    typeof lineText !== 'string'
                ) {
                    return true;
                }

                const absolutePath = path.resolve(options.cwd, relativePath);
                files.add(absolutePath);
                matches.push({
                    file: absolutePath,
                    lineNumber,
                    line: lineText.replace(/\r?\n$/, ''),
                });

                return matches.length < limit;
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!options.literal && /pcre2|look-around|backreferences?/i.test(message)) {
            return null;
        }
        throw error;
    }

    return {
        matches,
        filesSearched: files.size,
        truncated: result.terminatedEarly,
    };
}
