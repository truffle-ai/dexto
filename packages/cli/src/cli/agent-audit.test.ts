import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { auditCommander } from './agent-audit.js';

describe('agent CLI audit', () => {
    it('includes executable parents and nested commands with their declared flags and examples', () => {
        const program = new Command('dexto');
        const init = program.command('init').action(() => {});
        init.command('status')
            .option('--json')
            .addHelpText('after', '\nExamples:\n  dexto init status')
            .action(() => {});
        expect(auditCommander(program)).toEqual([
            {
                command: 'init',
                json: false,
                dryRun: false,
                nonInteractiveFlag: false,
                examples: false,
            },
            {
                command: 'init status',
                json: true,
                dryRun: false,
                nonInteractiveFlag: false,
                examples: true,
            },
        ]);
    });
});

it('includes dynamically constructed cloud commands from the registry', async () => {
    const { auditCloud } = await import('./agent-audit.js');
    const commands = (['approve', 'reject'] as const).map((action) => ({
        path: ['cloud', 'agents', action],
        summary: action,
        options: {},
        run: async () => {},
    }));
    expect(auditCloud(commands).map((row) => row.command)).toEqual([
        'cloud agents approve',
        'cloud agents reject',
    ]);
});
