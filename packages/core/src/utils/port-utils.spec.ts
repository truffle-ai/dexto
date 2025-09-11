import { describe, it, expect } from 'vitest';
import { getPort } from './port-utils.js';

describe('getPort', () => {
    it('returns default if envVar is undefined', () => {
        expect(getPort(undefined, 3000, 'TEST')).toBe(3000);
    });

    it('parses valid numeric string', () => {
        expect(getPort('8080', 3000, 'TEST')).toBe(8080);
    });

    it('throws error for non-numeric string', () => {
        expect(() => getPort('not-a-number', 3000, 'TEST')).toThrow(
            'Environment variable TEST value "not-a-number" is not a valid port'
        );
    });

    it('throws error for negative port', () => {
        expect(() => getPort('-1', 3000, 'TEST')).toThrow(
            'Environment variable TEST value "-1" is not a valid port'
        );
    });

    it('throws error for port > 65535', () => {
        expect(() => getPort('70000', 3000, 'TEST')).toThrow(
            'Environment variable TEST value "70000" is not a valid port'
        );
    });
});
