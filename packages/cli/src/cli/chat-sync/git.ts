/** Bounded, isolated Git calls for moving a chat without inheriting terminal/config side effects. */
import { spawn } from 'node:child_process';

export const handOffDiffOptions: readonly string[] = [
    '--submodule=short',
    '--no-color',
    '--no-renames',
    '--binary',
    '--no-ext-diff',
    '--no-textconv',
    '--src-prefix=a/',
    '--dst-prefix=b/',
];

export function handOffGit(cwd: string, args: string[], env = process.env): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            'git',
            [
                '-c',
                'core.hooksPath=/dev/null',
                '-c',
                'diff.submodule=short',
                '-c',
                'color.ui=never',
                ...args,
            ],
            {
                cwd,
                detached: true,
                stdio: ['ignore', 'pipe', 'ignore'],
                env: { ...env, GIT_NO_REPLACE_OBJECTS: '1' },
            }
        );
        const chunks: Buffer[] = [];
        let size = 0;
        child.stdout.on('data', (chunk: Buffer) => {
            size += chunk.byteLength;
            if (size > 64 * 1024 * 1024) {
                child.kill();
                reject(new Error('Git output exceeded the hand-off size limit.'));
                return;
            }
            chunks.push(chunk);
        });
        child.once('error', reject);
        child.once('close', (code) =>
            code === 0
                ? resolve(Buffer.concat(chunks))
                : reject(new Error(`Git ${args[0]} failed (${code}).`))
        );
    });
}
