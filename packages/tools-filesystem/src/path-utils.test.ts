import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { expandHomeShorthand, resolveUserPath } from './path-utils.js';

describe('path-utils', () => {
    it('expands bare home shorthand', () => {
        expect(expandHomeShorthand('~')).toBe(os.homedir());
    });

    it('expands home shorthand with nested path segments', () => {
        expect(expandHomeShorthand('~/Projects/test.md')).toBe(
            path.join(os.homedir(), 'Projects', 'test.md')
        );
        expect(expandHomeShorthand('~\\Projects\\test.md')).toBe(
            path.join(os.homedir(), 'Projects\\test.md')
        );
    });

    it('does not expand unsupported user-home syntax', () => {
        expect(expandHomeShorthand('~other-user/file.txt')).toBe('~other-user/file.txt');
    });

    it('resolves home shorthand before relative resolution', () => {
        expect(resolveUserPath('/workspace', '~/Projects/test.md')).toBe(
            path.join(os.homedir(), 'Projects', 'test.md')
        );
        expect(resolveUserPath('/workspace', 'notes/today.md')).toBe('/workspace/notes/today.md');
        expect(resolveUserPath('~', 'notes/today.md')).toBe(
            path.join(os.homedir(), 'notes/today.md')
        );
    });
});
