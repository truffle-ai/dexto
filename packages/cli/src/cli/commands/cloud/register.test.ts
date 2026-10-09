import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCloudCommand } from './register.js';

const mocked = vi.hoisted(() => ({ runCloudDiscovery: vi.fn(), safeExit: vi.fn() }));
vi.mock('./discovery.js', () => ({ runCloudDiscovery: mocked.runCloudDiscovery }));
vi.mock('../../../analytics/wrapper.js', () => ({
    withAnalytics: (_name: string, action: (...args: unknown[]) => unknown) => action,
    safeExit: mocked.safeExit,
}));

describe('Cloud command registration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocked.runCloudDiscovery.mockResolvedValue(0);
    });
    it.each([
        {
            args: ['sources', '--limit', '3'],
            command: { command: 'sources' },
            options: { json: true, limit: '3' },
        },
        {
            args: ['search', 'drive files', '--offset', '4'],
            command: { command: 'search', query: 'drive files' },
            options: { json: true, offset: '4' },
        },
        {
            args: ['describe', 'drive.list'],
            command: { command: 'describe', path: 'drive.list' },
            options: { json: true },
        },
    ])('registers $args', async ({ args, command, options }) => {
        const program = new Command();
        registerCloudCommand(program);
        await program.parseAsync(['cloud', ...args, '--json'], { from: 'user' });
        expect(mocked.runCloudDiscovery).toHaveBeenCalledWith(command, options);
        expect(mocked.safeExit).toHaveBeenCalledWith(`cloud ${command.command}`, 0);
    });
});
