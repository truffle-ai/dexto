import { describe, expect, it } from 'vitest';
import { groupProjects } from './projects.js';
import type { LocalChat } from './transcript.js';

function chat(id: string, root: string): LocalChat {
    return {
        id,
        repository: { root, remoteUrl: null },
        cwd: root,
        gitBranch: null,
        messages: [],
        path: '',
        pullRequests: [],
        source: 'codex',
        startedAt: '',
        title: id,
        updatedAt: '',
    };
}

describe('groupProjects', () => {
    it('groups chats from the same repository together', () => {
        const groups = groupProjects([
            chat('one', '/repo'),
            chat('two', '/repo'),
            chat('three', '/other'),
        ]);
        expect(groups.map((group) => group.chats.map((item) => item.id))).toEqual([
            ['one', 'two'],
            ['three'],
        ]);
    });
});
