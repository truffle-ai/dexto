import { describe, expect, it } from 'vitest';
import { formatPermissionsMode } from './permissions-mode-display.js';

describe('formatPermissionsMode', () => {
    it('labels local modes and passes other backend values through', () => {
        expect(formatPermissionsMode('full-access')).toBe('Full access');
        expect(formatPermissionsMode('asks-you')).toBe('Asks you');
        expect(formatPermissionsMode('cloud')).toBe('cloud');
    });
});
