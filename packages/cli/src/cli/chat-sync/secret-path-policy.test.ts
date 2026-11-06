/** Exercises the shared secret-path cases and the repository's tracked tree. */
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { isSecretPath } from './redaction.js';
import { allowedSecretPathCases, refusedSecretPathCases } from './secret-path-cases.js';

it.each(allowedSecretPathCases)('allows source, documentation or example %s', (name) => {
    expect(isSecretPath(name)).toBe(false);
});

it.each(refusedSecretPathCases)('refuses secret-shaped file %s anywhere', (name) => {
    expect(isSecretPath(name)).toBe(true);
    expect(isSecretPath(`nested/${name}`)).toBe(true);
});

const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
}).trim();
function refusedPaths(args: string[]): string[] {
    const paths = execFileSync('git', args, {
        cwd: repository,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' },
    })
        .split('\0')
        .filter(Boolean);
    return [...new Set(paths.filter(isSecretPath))];
}
it('allows every tracked file in the full repository tree', () => {
    expect(refusedPaths(['ls-tree', '--full-tree', '-r', '--name-only', '-z', 'HEAD'])).toEqual([]);
});
it('allows every path in the full upstream history', () => {
    expect(
        execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
            cwd: repository,
            encoding: 'utf8',
        }).trim()
    ).toBe('false');
    const upstream = 'HEAD';
    const refused = refusedPaths([
        'log',
        '--root',
        '--diff-merges=separate',
        '--no-renames',
        '--no-color',
        '--name-only',
        '--format=',
        '-z',
        upstream,
        '--',
    ]);
    console.log(
        'ACCEPTANCE full-tree + full-history: ' + upstream + ', refused=' + JSON.stringify(refused)
    );
    expect(refused).toEqual([]);
}, 30_000);
