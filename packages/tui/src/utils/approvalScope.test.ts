import { describe, expect, it } from 'vitest';
import { formatApprovalScope } from './approvalScope.js';

describe('formatApprovalScope', () => {
    it('names a directory approval in words, not its internal key', () => {
        expect(
            formatApprovalScope({ kind: 'action', value: 'directory:/tmp/outside:operation:edit' })
        ).toBe('edits in /tmp/outside');
        expect(
            formatApprovalScope({ kind: 'action', value: 'directory:/tmp/outside:operation:read' })
        ).toBe('reads in /tmp/outside');
    });

    it('still names a directory approved for every operation', () => {
        expect(formatApprovalScope({ kind: 'action', value: 'directory:/tmp/outside' })).toBe(
            'access in /tmp/outside'
        );
    });

    it('leaves tools, commands and other keys as they were', () => {
        expect(formatApprovalScope({ kind: 'tool', value: 'bash_exec' })).toBe('tool bash_exec');
        expect(formatApprovalScope({ kind: 'action', value: 'bash:git *' })).toBe('git *');
        expect(formatApprovalScope({ kind: 'action', value: 'other:key' })).toBe('other:key');
    });
});
