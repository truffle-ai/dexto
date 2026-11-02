/**
 * How many files `git status` lists as changed, refreshed after each run. Runs git
 * asynchronously so a large repository never blocks a frame.
 */
import { execFile } from 'node:child_process';
import { useEffect, useState } from 'react';
import type { TuiAgentBackend } from '../agent-backend.js';

/** Changed paths in `git status --porcelain` output. */
export function countDirtyFiles(porcelain: string): number {
    return porcelain.split('\n').filter((line) => line.trim() !== '').length;
}

export function useGitDirtyFiles(agent: TuiAgentBackend, cwd: string): number {
    const [count, setCount] = useState(0);
    useEffect(() => {
        let cancelled = false;
        const refresh = () => {
            execFile(
                'git',
                ['status', '--porcelain'],
                { cwd, timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
                (error, stdout) => {
                    if (cancelled) return;
                    setCount(error ? 0 : countDirtyFiles(stdout));
                }
            );
        };
        refresh();
        const controller = new AbortController();
        agent.on('run:complete', refresh, { signal: controller.signal });
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [agent, cwd]);
    return count;
}
