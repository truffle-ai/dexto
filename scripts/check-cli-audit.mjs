import process from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { auditDiff, exampleRegressions } from './cli-audit-diff.mjs';

const baseline = 'packages/cli/agent-audit-baseline.json';
const pendingExamples = 'scripts/cli-audit-pending-examples.json';
const result = spawnSync(
    process.execPath,
    ['packages/cli/dist/index-main.js', '--audit-agent-cli'],
    { encoding: 'utf8' }
);
if (result.status !== 0) {
    process.stderr.write(result.stderr || 'CLI audit could not run.\n');
    process.exit(result.status ?? 1);
}
let actual;
try {
    actual = JSON.parse(result.stdout);
    if (!Array.isArray(actual)) throw new Error('Expected an array.');
} catch {
    process.stderr.write('CLI audit returned invalid or empty JSON.\n');
    process.exit(1);
}
const expected = JSON.parse(readFileSync(baseline, 'utf8'));
const pending = JSON.parse(readFileSync(pendingExamples, 'utf8'));
const baseBranch = process.env.GITHUB_BASE_REF ?? 'main';
const remoteBase = `origin/${baseBranch}`;
const mergeBase = process.env.GITHUB_BASE_REF
    ? null
    : spawnSync('git', ['merge-base', 'HEAD', remoteBase], { encoding: 'utf8' });
const baseRef = process.env.GITHUB_BASE_REF
    ? remoteBase
    : mergeBase?.status === 0
      ? mergeBase.stdout.trim()
      : 'HEAD';
const baseResult = spawnSync('git', ['show', `${baseRef}:${baseline}`], {
    encoding: 'utf8',
});
if (baseResult.status !== 0 && process.env.GITHUB_BASE_REF) {
    process.stderr.write(`Cannot read the CLI audit baseline from ${baseRef}.\n`);
    process.exit(1);
}
const base = baseResult.status === 0 ? JSON.parse(baseResult.stdout) : expected;
const pendingResult = spawnSync('git', ['show', `${baseRef}:${pendingExamples}`], {
    encoding: 'utf8',
});
if (pendingResult.status === 0) {
    const previous = JSON.parse(pendingResult.stdout);
    const added = pending.filter(
        (row) => !previous.some((old) => old.command === row.command && old.pr === row.pr)
    );
    if (added.length > 0) {
        process.stderr.write(
            `Cannot add CLI example exceptions:\n${added.map((row) => row.command).join('\n')}\n`
        );
        process.exit(1);
    }
}
const regressions = exampleRegressions(
    base,
    expected,
    actual,
    pending.map((row) => row.command)
);
if (regressions.length > 0) {
    process.stderr.write(`CLI examples regressed:\n${regressions.join('\n')}\n`);
    process.exit(1);
}
if (process.argv.includes('--write')) {
    writeFileSync(baseline, `${JSON.stringify(actual, null, 2)}\n`);
    process.exit(0);
}
const changes = auditDiff(expected, actual);
if (changes.length > 0) {
    process.stderr.write(
        `CLI audit changed:\n${changes.join('\n')}\nReview these changes, then run node scripts/check-cli-audit.mjs --write.\n`
    );
    process.exit(1);
}
