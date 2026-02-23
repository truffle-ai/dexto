import { describe, expect, it } from 'vitest';
import { formatToolHeader } from './messageFormatting.js';

describe('formatToolHeader fallback args', () => {
    it('truncates from the start (not mid-string)', () => {
        const long =
            'with base path set to packages/server (or absolute if needed). ' +
            'Summarize key directories and notable config/source files.';

        const { header } = formatToolHeader({
            toolName: 'spawn_agent',
            args: {
                instructions: long + ' '.repeat(10) + 'X'.repeat(500),
            },
        });

        expect(header).toContain('instructions=with base path set to packages/server');
        expect(header).toContain('...');
    });
});
