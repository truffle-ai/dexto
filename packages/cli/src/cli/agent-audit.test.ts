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

it('reports cloud command examples from the declared help', async () => {
    const { auditCloud } = await import('./agent-audit.js');
    expect(
        auditCloud([
            {
                path: ['credits', 'balance'],
                summary: 'balance',
                examples: ['dexto credits balance --json'],
                run: async () => {},
            },
        ])[0]
    ).toMatchObject({ examples: true });
});

it('replaces cloud passthroughs including new nested chat commands', async () => {
    const { auditProgram } = await import('./agent-audit.js');
    const program = new Command('dexto');
    program.command('cloud').action(() => {});
    program
        .command('chat')
        .command('new')
        .action(() => {});
    const commands = [
        { path: ['cloud', 'items', 'list'], summary: 'list', run: async () => {} },
        { path: ['chat', 'new'], summary: 'new', run: async () => {} },
    ];
    expect(auditProgram(program, commands).map((row) => row.command)).toEqual([
        'chat new',
        'cloud items list',
    ]);
});

it('reports declared options without confusing description text for an examples section', () => {
    const program = new Command('dexto');
    program
        .command('write')
        .description('More examples: see elsewhere')
        .option('--json')
        .option('--dry-run')
        .option('--non-interactive')
        .action(() => {});
    expect(auditCommander(program)).toEqual([
        { command: 'write', json: true, dryRun: true, nonInteractiveFlag: true, examples: false },
    ]);
});
