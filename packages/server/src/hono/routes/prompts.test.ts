import { describe, expect, it, vi } from 'vitest';
import type { DextoAgent } from '@dexto/core';
import { createPromptsRouter } from './prompts.js';

describe('createPromptsRouter', () => {
    it('lists prompts from prompt APIs without reading SkillManager', async () => {
        const listPrompts = vi.fn(async () => ({
            'starter:help': {
                name: 'starter:help',
                title: 'Help',
                source: 'config' as const,
                metadata: { showInStarters: true },
            },
        }));
        const listSkills = vi.fn(async () => [
            {
                id: 'review',
                displayName: 'Code Review',
            },
        ]);
        const agent = {
            listPrompts,
            skillManager: {
                list: listSkills,
            },
        } as unknown as DextoAgent;
        const app = createPromptsRouter(async () => agent);

        const response = await app.request('/prompts');

        expect(response.status).toBe(200);
        expect(listPrompts).toHaveBeenCalledOnce();
        expect(listSkills).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toEqual({
            prompts: [
                {
                    name: 'starter:help',
                    title: 'Help',
                    source: 'config',
                    metadata: { showInStarters: true },
                },
            ],
        });
    });
});
