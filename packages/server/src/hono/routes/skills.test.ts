import { describe, expect, it, vi } from 'vitest';
import type { DextoAgent } from '@dexto/core';
import { createSkillsRouter } from './skills.js';

function createAgent() {
    const list = vi.fn(async () => [
        {
            id: 'review',
            displayName: 'Code Review',
            description: 'Review a change',
        },
    ]);
    const get = vi.fn(async (id: string) =>
        id === 'review'
            ? {
                  id: 'review',
                  displayName: 'Code Review',
                  description: 'Review a change',
                  instructions: 'Inspect the diff and report risks.',
              }
            : null
    );
    const invoke = vi.fn();

    return {
        agent: {
            skillManager: {
                list,
                get,
                invoke,
                readFile: vi.fn(),
                refresh: vi.fn(),
            },
        } as unknown as DextoAgent,
        list,
        get,
        invoke,
    };
}

describe('createSkillsRouter', () => {
    it('lists skills from SkillManager without invoking them', async () => {
        const { agent, list, invoke } = createAgent();
        const app = createSkillsRouter(async () => agent);

        const response = await app.request('/skills');

        expect(response.status).toBe(200);
        expect(list).toHaveBeenCalledOnce();
        expect(invoke).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toEqual({
            skills: [
                {
                    id: 'review',
                    displayName: 'Code Review',
                    description: 'Review a change',
                },
            ],
        });
    });

    it('reads one skill document from SkillManager', async () => {
        const { agent, get, invoke } = createAgent();
        const app = createSkillsRouter(async () => agent);

        const response = await app.request('/skills/review');

        expect(response.status).toBe(200);
        expect(get).toHaveBeenCalledWith('review');
        expect(invoke).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toEqual({
            skill: {
                id: 'review',
                displayName: 'Code Review',
                description: 'Review a change',
                instructions: 'Inspect the diff and report risks.',
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
