import { Command } from 'commander';
import { beforeEach, expect, it, vi } from 'vitest';
import { registerSessionCommand } from './register.js';
import { runCloud } from '../../cloud/run.js';
import { nodeCloudHost } from '../../cloud/host.js';

vi.mock('../../../analytics/wrapper.js', () => ({
    withAnalytics: (_name: string, action: (...args: unknown[]) => unknown) => action,
    safeExit: vi.fn(),
    ExitSignal: class extends Error {},
}));
vi.mock('../../cloud/run.js', () => ({ runCloud: vi.fn(async () => 0) }));
vi.mock('../../cloud/host.js', () => ({ nodeCloudHost: vi.fn(() => ({})) }));

beforeEach(() => vi.clearAllMocks());

it.each([
    ['start', 'Investigate', '--computer', 'computer-1', '--browser-profile', 'profile-1'],
    ['computers'],
    ['browser-profiles'],
])('registers public chat %s and forwards its arguments to the cloud engine', async (...args) => {
    const program = new Command().name('dexto').enablePositionalOptions().exitOverride();
    registerSessionCommand({
        program,
        cliVersion: '2.0.0',
        bootstrapAgentFromGlobalOpts: async () => {
            throw new Error('Cloud chats must not bootstrap a local agent.');
        },
    });
    await program.parseAsync(['chat', ...args], { from: 'user' });
    expect(runCloud).toHaveBeenCalledWith(vi.mocked(nodeCloudHost).mock.results[0]?.value, [
        'chat',
        ...args,
    ]);
});
