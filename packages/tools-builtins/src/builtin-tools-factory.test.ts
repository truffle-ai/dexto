import { describe, expect, it } from 'vitest';
import type { Tool } from '@dexto/core';
import { builtinToolsFactory } from './builtin-tools-factory.js';

describe('builtinToolsFactory', () => {
    it('creates all builtins when enabledTools is omitted', () => {
        const tools: Tool[] = builtinToolsFactory.create({ type: 'builtin-tools' });
        expect(tools.map((t) => t.id)).toEqual([
            'ask_user',
            'delegate_to_url',
            'list_resources',
            'get_resource',
            'invoke_skill',
        ]);
    });

    it('creates only the selected builtins when enabledTools is provided', () => {
        const tools: Tool[] = builtinToolsFactory.create({
            type: 'builtin-tools',
            enabledTools: ['ask_user', 'invoke_skill'],
        });
        expect(tools.map((t) => t.id)).toEqual(['ask_user', 'invoke_skill']);
    });
});
