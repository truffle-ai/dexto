import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { auditDiff, exampleRegressions } from './cli-audit-diff.mjs';

it('identifies added commands and lost flags separately', () => {
    expect(
        auditDiff(
            [{ command: 'a', json: true, dryRun: false }],
            [
                { command: 'a', json: false, dryRun: true },
                { command: 'b', json: false, dryRun: false },
            ]
        )
    ).toEqual(['REGRESSION a: json true -> false', 'CHANGED a: dryRun false -> true', 'ADDED b']);
});

it('ratchets examples while allowing only named pending commands', () => {
    const base = [
        { command: 'old gap', examples: false },
        { command: 'has examples', examples: true },
        { command: 'reserved improved', examples: true },
    ];
    const actual = [
        { command: 'old gap', examples: true },
        { command: 'has examples', examples: false },
        { command: 'reserved improved', examples: false },
        { command: 'reserved new', examples: false },
        { command: 'unlisted new', examples: false },
        { command: 'new with examples', examples: true },
    ];
    expect(exampleRegressions(base, base, actual, ['reserved new', 'reserved improved'])).toEqual([
        'REGRESSION has examples: examples true -> false',
        'REGRESSION reserved improved: examples true -> false',
        'REGRESSION unlisted new: new command has no examples',
    ]);
    const mergedBase = [...base, { command: 'reserved new', examples: false }];
    expect(exampleRegressions(mergedBase, mergedBase, mergedBase, [])).toEqual([]);
    expect(exampleRegressions(base, base, [{ command: 'old gap', examples: true }], [])).toEqual(
        []
    );
});

it('rejects a rewritten baseline and allows the named pending command in either merge order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dexto-examples-audit-'));
    const exec = (program: string, args: string[]) =>
        spawnSync(program, args, {
            cwd: dir,
            encoding: 'utf8',
            env: {
                PATH: process.env.PATH,
                SystemRoot: process.env.SystemRoot,
                GITHUB_BASE_REF: 'cli-2.0',
            },
        });
    try {
        const cliDir = join(dir, 'packages/cli');
        mkdirSync(join(cliDir, 'dist'), { recursive: true });
        const baseline = join(cliDir, 'agent-audit-baseline.json');
        mkdirSync(join(dir, 'scripts'), { recursive: true });
        const pending = join(dir, 'scripts/cli-audit-pending-examples.json');
        const cli = join(cliDir, 'dist/index-main.js');
        const check = fileURLToPath(new URL('./check-cli-audit.mjs', import.meta.url));
        const before = [{ command: 'existing', examples: true }];
        const writeRows = (rows: { command: string; examples: boolean }[]) => {
            writeFileSync(cli, `console.log(${JSON.stringify(JSON.stringify(rows))});`);
        };
        writeFileSync(baseline, JSON.stringify(before));
        writeFileSync(pending, JSON.stringify([{ command: 'reserved', pr: 42 }]));
        expect(exec('git', ['init', '-q']).status).toBe(0);
        expect(exec('git', ['add', 'packages/cli/agent-audit-baseline.json']).status).toBe(0);
        expect(
            exec('git', [
                '-c',
                'user.name=Test',
                '-c',
                'user.email=test@example.com',
                'commit',
                '-qm',
                'base',
            ]).status
        ).toBe(0);
        expect(exec('git', ['update-ref', 'refs/remotes/origin/cli-2.0', 'HEAD']).status).toBe(0);

        const reserved = [...before, { command: 'reserved', examples: false }];
        writeRows(reserved);
        expect(exec(process.execPath, [check, '--write']).status).toBe(0);
        expect(JSON.parse(readFileSync(baseline, 'utf8'))).toEqual(reserved);
        expect(exec('git', ['add', 'scripts/cli-audit-pending-examples.json']).status).toBe(0);
        expect(
            exec('git', [
                '-c',
                'user.name=Test',
                '-c',
                'user.email=test@example.com',
                'commit',
                '-qm',
                'ratchet',
            ]).status
        ).toBe(0);
        expect(exec('git', ['update-ref', 'refs/remotes/origin/cli-2.0', 'HEAD']).status).toBe(0);
        expect(exec(process.execPath, [check]).status).toBe(0);

        const unapproved = [...reserved, { command: 'unapproved', examples: false }];
        writeRows(unapproved);
        expect(exec(process.execPath, [check, '--write']).status).toBe(1);
        expect(JSON.parse(readFileSync(baseline, 'utf8'))).toEqual(reserved);
        writeFileSync(baseline, JSON.stringify(unapproved));
        expect(exec(process.execPath, [check]).status).toBe(1);
        writeFileSync(
            pending,
            JSON.stringify([
                { command: 'reserved', pr: 42 },
                { command: 'unapproved', pr: 43 },
            ])
        );
        expect(exec(process.execPath, [check]).status).toBe(1);
        writeFileSync(pending, JSON.stringify([{ command: 'reserved', pr: 42 }]));

        const lost = [{ command: 'existing', examples: false }];
        writeRows(lost);
        writeFileSync(baseline, JSON.stringify(lost));
        expect(exec(process.execPath, [check, '--write']).status).toBe(1);
        expect(JSON.parse(readFileSync(baseline, 'utf8'))).toEqual(lost);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}, 20_000);

it('uses the merge base when local main advanced with an unrelated improvement', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dexto-examples-base-'));
    const exec = (program: string, args: string[]) =>
        spawnSync(program, args, {
            cwd: dir,
            encoding: 'utf8',
            env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
        });
    try {
        const cliDir = join(dir, 'packages/cli');
        mkdirSync(join(cliDir, 'dist'), { recursive: true });
        mkdirSync(join(dir, 'scripts'), { recursive: true });
        const baseline = join(cliDir, 'agent-audit-baseline.json');
        const oldRows = [{ command: 'existing', examples: false }];
        writeFileSync(baseline, JSON.stringify(oldRows));
        writeFileSync(join(dir, 'scripts/cli-audit-pending-examples.json'), '[]');
        writeFileSync(
            join(cliDir, 'dist/index-main.js'),
            `console.log(${JSON.stringify(JSON.stringify(oldRows))});`
        );
        expect(exec('git', ['init', '-q']).status).toBe(0);
        expect(exec('git', ['add', 'packages/cli/agent-audit-baseline.json']).status).toBe(0);
        const commit = [
            '-c',
            'user.name=Test',
            '-c',
            'user.email=test@example.com',
            'commit',
            '-qm',
        ];
        expect(exec('git', [...commit, 'base']).status).toBe(0);
        expect(exec('git', ['switch', '-qc', 'feature']).status).toBe(0);
        expect(exec('git', ['switch', '-qc', 'advanced-main']).status).toBe(0);
        writeFileSync(baseline, JSON.stringify([{ command: 'existing', examples: true }]));
        expect(exec('git', ['add', 'packages/cli/agent-audit-baseline.json']).status).toBe(0);
        expect(exec('git', [...commit, 'improve help']).status).toBe(0);
        expect(exec('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD']).status).toBe(0);
        expect(exec('git', ['switch', '-q', 'feature']).status).toBe(0);
        const check = fileURLToPath(new URL('./check-cli-audit.mjs', import.meta.url));
        expect(exec(process.execPath, [check]).status).toBe(0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
