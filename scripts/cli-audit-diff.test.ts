import { expect, it } from 'vitest';
import { auditDiff } from './cli-audit-diff.mjs';

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
