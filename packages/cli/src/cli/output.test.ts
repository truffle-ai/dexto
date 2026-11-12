import { expect, it } from 'vitest';
import { jsonError } from './output.js';

it('formats the existing error envelope without inventing a fix', () => {
    expect(JSON.parse(jsonError({ code: 'invalid_input', message: 'Missing --name.' }))).toEqual({
        error: { code: 'invalid_input', message: 'Missing --name.' },
    });
});

it('formats one JSON result with a terminating newline', async () => {
    const { jsonResult } = await import('./output.js');
    expect(jsonResult({ sessions: [] })).toBe('{\n  "sessions": []\n}\n');
});
