import { describe, expect, it } from 'vitest';
import {
    isToolPresentationSnapshotV1,
    ToolPresentationSnapshotV1Schema,
} from './presentation-schema.js';

describe('ToolPresentationSnapshotV1Schema', () => {
    it('validates structured first-party activity metadata', () => {
        const snapshot = {
            version: 1,
            source: { type: 'local' },
            activity: {
                category: 'command',
                label: { running: 'Running command', completed: 'Ran command' },
                summary: { verb: 'Ran', singular: 'a command', plural: 'commands' },
            },
            header: { title: 'Bash', argsText: 'pnpm test' },
        };

        expect(ToolPresentationSnapshotV1Schema.parse(snapshot)).toEqual(snapshot);
        expect(isToolPresentationSnapshotV1(snapshot)).toBe(true);
    });

    it('rejects invalid activity metadata instead of admitting loosely typed JSON', () => {
        expect(
            isToolPresentationSnapshotV1({
                version: 1,
                activity: {
                    category: '',
                    label: { running: 'Doing thing', completed: 'Did thing' },
                    summary: { verb: 'Did', singular: 'a thing', plural: 'things' },
                },
            })
        ).toBe(false);
    });
});
