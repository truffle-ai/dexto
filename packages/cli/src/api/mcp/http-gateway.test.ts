import { describe, expect, it } from 'vitest';
import { allowsMcpHttpRequestOrigin } from './http-gateway.js';

describe('MCP HTTP listener authority', () => {
    it.each<[string, number, string, string | undefined, boolean]>([
        ['127.0.0.1', 80, '127.0.0.1', 'http://127.0.0.1', true],
        ['127.0.0.1', 3001, '127.0.0.1:3001', 'http://127.0.0.1:3001', true],
        ['127.0.0.1', 80, 'attacker.example', 'http://127.0.0.1', false],
        ['127.0.0.1', 80, '127.0.0.1', 'http://attacker.example', false],
        ['::1', 80, '[::1]', 'http://[::1]', true],
        ['::1', 3001, '[::1]:3001', 'http://[::1]:3001', true],
        ['::', 3001, 'external-ingress.example', undefined, true],
    ])('checks %s:%s with Host=%s and Origin=%s', (host, port, authority, origin, allowed) => {
        expect(allowsMcpHttpRequestOrigin(host, port, { host: authority, origin })).toBe(allowed);
    });
});
