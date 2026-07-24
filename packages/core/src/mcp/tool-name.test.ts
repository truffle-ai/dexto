import { describe, expect, it } from 'vitest';

import { isValidMcpNamespace, normalizeMcpNamespace, parseMcpModelToolName } from './tool-name.js';

describe('MCP tool names', () => {
    it('normalizes host labels into stable JavaScript-safe namespaces', () => {
        expect(normalizeMcpNamespace(' GitHub Work ')).toBe('github_work');
        expect(normalizeMcpNamespace('GitHub__Work')).toBe('github_work');
        expect(normalizeMcpNamespace('123 Tools')).toBe('_123_tools');
        expect(normalizeMcpNamespace('_123 Tools')).toBe('_123_tools');
        expect(normalizeMcpNamespace('then')).toBe('_then');
        expect(normalizeMcpNamespace('_then')).toBe('_then');
        expect(isValidMcpNamespace('github_work')).toBe(true);
        expect(isValidMcpNamespace('github__work')).toBe(false);
        expect(isValidMcpNamespace('GitHub Work')).toBe(false);
    });

    it('parses provider-safe names without splitting separators in upstream tool names', () => {
        expect(parseMcpModelToolName('mcp__github_work__create__issue')).toEqual({
            namespace: 'github_work',
            toolName: 'create__issue',
        });
        expect(parseMcpModelToolName('mcp__github_work')).toBeUndefined();
    });
});
