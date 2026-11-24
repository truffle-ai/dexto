import { expect, it } from 'vitest';
import { builtCloudCommands } from '../../cloud/host.js';
import { ENGINE_WORDS } from './register.js';

/** `chat` is its own top-level command, which hands its cloud verbs to the engine itself. */
const ROUTED_ELSEWHERE = new Set(['chat']);

it('routes every cloud command root word to the cloud engine', () => {
    const roots = builtCloudCommands('', async () => {
        throw new Error('No sign-in in this test.');
    }).map((command) => command.path[0] ?? '');
    const unrouted = roots.filter((word) => !(word in ENGINE_WORDS) && !ROUTED_ELSEWHERE.has(word));
    expect([...new Set(unrouted)]).toEqual([]);
});
