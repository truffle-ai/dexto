import process from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { auditDiff } from './cli-audit-diff.mjs';

const baseline = 'packages/cli/agent-audit-baseline.json';
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
if (process.argv.includes('--write')) {
    writeFileSync(baseline, `${JSON.stringify(actual, null, 2)}\n`);
    process.exit(0);
}
const expected = JSON.parse(readFileSync(baseline, 'utf8'));
const changes = auditDiff(expected, actual);
if (changes.length > 0) {
    process.stderr.write(
        `CLI audit changed:\n${changes.join('\n')}\nReview these changes, then run node scripts/check-cli-audit.mjs --write.\n`
    );
    process.exit(1);
}
