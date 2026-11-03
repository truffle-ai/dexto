import process from 'node:process';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const result = spawnSync(
    process.execPath,
    ['packages/cli/dist/index-main.js', '--audit-agent-cli'],
    {
        encoding: 'utf8',
    }
);
if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
}
const expected = JSON.parse(readFileSync('packages/cli/agent-audit-baseline.json', 'utf8'));
const actual = JSON.parse(result.stdout);
if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    process.stderr.write(
        'CLI audit changed. Review command coverage and update packages/cli/agent-audit-baseline.json.\n'
    );
    process.exit(1);
}
