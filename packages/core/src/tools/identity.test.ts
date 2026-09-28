import { describe, expect, it } from 'vitest';

import { ToolIdentitySchema } from './identity.js';

describe('ToolIdentitySchema', () => {
    it('preserves the canonical local and MCP identity shapes', () => {
        expect(ToolIdentitySchema.parse({ type: 'local', toolId: 'read_file' })).toEqual({
            type: 'local',
            toolId: 'read_file',
        });
        expect(
            ToolIdentitySchema.parse({
                connectionId: 'linear-primary',
                toolName: 'list_issues',
                type: 'mcp',
            })
        ).toEqual({
            connectionId: 'linear-primary',
            toolName: 'list_issues',
            type: 'mcp',
        });
    });

    it('rejects an MCP identity without a connection boundary', () => {
        expect(ToolIdentitySchema.safeParse({ type: 'mcp', toolName: 'list_issues' }).success).toBe(
            false
        );
    });
});
