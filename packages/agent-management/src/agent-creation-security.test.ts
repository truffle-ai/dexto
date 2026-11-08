import { describe, expect, it } from 'vitest';
import { createDextoAgentFromConfig } from './agent-creation.js';

describe('agent creation config keys', () => {
    it.each(['__proto__', 'constructor', 'prototype'])(
        'rejects nested %s before loading an image',
        async (key) => {
            const config = JSON.parse(`{"tools":[{"${key}":{"polluted":true}}]}`);
            await expect(createDextoAgentFromConfig({ config })).rejects.toThrow(
                'Forbidden configuration key'
            );
            expect(Object.prototype).not.toHaveProperty('polluted');
        }
    );
});
