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

it('allows every tracked file in the repository tree', () => {
    const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', 'HEAD'], {
        encoding: 'utf8',
    })
        .split('\0')
        .filter(Boolean);
    expect(paths.filter(isSecretPath)).toEqual([]);
});
