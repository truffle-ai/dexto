import { describe, expect, it, vi } from 'vitest';
import type { DextoAgent } from '@dexto/core';
import { createSkillsRouter } from './skills.js';

function createAgent() {
    const list = vi.fn(async () => [
        {
            name: 'review',
            description: 'Review a change',
        },
    ]);
    const load = vi.fn(async (name: string) =>
        name === 'review'
            ? {
                  name: 'review',
                  instructions: 'Inspect the diff and report risks.',
                  supportingFiles: [],
                  filesLocation: 'hosted' as const,
                  baseDirectory: null,
              }
            : null
    );

    return {
        agent: {
            skills: { list, load, readFile: vi.fn() },
        } as unknown as DextoAgent,
        list,
        load,
    };
}

describe('createSkillsRouter', () => {
    it('lists skill summaries without loading them', async () => {
        const { agent, list, load } = createAgent();
        const app = createSkillsRouter(async () => agent);

        const response = await app.request('/skills');

        expect(response.status).toBe(200);
        expect(list).toHaveBeenCalledOnce();
        expect(load).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toEqual({
            skills: [
                {
                    name: 'review',
                    description: 'Review a change',
                },
            ],
        });
    });

    it('loads one skill by its exact name', async () => {
        const { agent, load } = createAgent();
        const app = createSkillsRouter(async () => agent);

        const response = await app.request('/skills/review');

        expect(response.status).toBe(200);
        expect(load).toHaveBeenCalledWith('review');
        await expect(response.json()).resolves.toEqual({
            skill: {
                name: 'review',
                instructions: 'Inspect the diff and report risks.',
                supportingFiles: [],
                filesLocation: 'hosted',
                baseDirectory: null,
            },
        });
    });

    it('returns 404 when a skill is not available', async () => {
        const { agent } = createAgent();
        const app = createSkillsRouter(async () => agent);

        const response = await app.request('/skills/missing');

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toMatchObject({
            message: 'Skill not found: missing',
            endpoint: '/skills/missing',
            method: 'GET',
        });
    });
});
