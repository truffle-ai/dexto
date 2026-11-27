import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { helpJson, jsonHelpCommand, rootHelpJson } from './help-json.js';

/** The real tree's shape: Commander's own commands, and the engine's with no help option. */
function tree(): Command {
    const program = new Command('dexto');
    const chat = program.command('chat').description('Your local and cloud chats');
    chat.command('delete')
        .description('Delete a chat')
        .argument('<sessionId>', 'The chat to delete')
        .option('--dry-run', 'Print what would be deleted');
    chat.command('list').description('List your chats').helpOption(false);
    program.command('whoami').description('Show who Dexto commands act as').helpOption(false);
    return program;
}

describe('dexto [command…] --help --json', () => {
    it('is asked for with --help (or -h) and --json', () => {
        const program = tree();

        expect(jsonHelpCommand(program, ['--help', '--json'])).toBe(program);
        expect(jsonHelpCommand(program, ['--json', '-h'])).toBe(program);
        expect(jsonHelpCommand(program, ['--help'])).toBeNull();
        expect(jsonHelpCommand(program, ['chat', '--json'])).toBeNull();
    });

    it('answers for the deepest command its words name', () => {
        const program = tree();

        expect(jsonHelpCommand(program, ['chat', '--help', '--json'])?.name()).toBe('chat');
        expect(jsonHelpCommand(program, ['chat', 'delete', '-h', '--json'])?.name()).toBe('delete');
        expect(jsonHelpCommand(program, ['bogus', '--help', '--json'])).toBe(program);
    });

    it('leaves a cloud engine command, which has no Commander help, to the engine', () => {
        expect(jsonHelpCommand(tree(), ['whoami', '--help', '--json'])).toBeNull();
        expect(jsonHelpCommand(tree(), ['chat', 'list', '--help', '--json'])).toBeNull();
    });

    it("gives a command's usage, arguments, options and commands", () => {
        const chat = jsonHelpCommand(tree(), ['chat', '--help', '--json']);
        const del = jsonHelpCommand(tree(), ['chat', 'delete', '--help', '--json']);
        if (chat === null || del === null) throw new Error('expected commands');

        expect(helpJson(chat)).toEqual({
            usage: 'dexto chat [options] [command]',
            summary: 'Your local and cloud chats',
            arguments: [],
            options: [{ name: '-h, --help', description: 'display help for command' }],
            commands: [
                {
                    name: 'delete',
                    summary: 'Delete a chat',
                    help: 'dexto chat delete --help --json',
                },
                { name: 'list', summary: 'List your chats', help: 'dexto chat list --help --json' },
            ],
        });
        expect(helpJson(del)).toEqual({
            usage: 'dexto chat delete [options] <sessionId>',
            summary: 'Delete a chat',
            arguments: [{ name: 'sessionId', required: true, description: 'The chat to delete' }],
            options: [
                { name: '--dry-run', description: 'Print what would be deleted' },
                { name: '-h, --help', description: 'display help for command' },
            ],
            commands: [],
        });
    });

    it('lists every command and the frozen exit codes', () => {
        const program = new Command('dexto');
        program.command('run').description('Run a single prompt');
        program.command('login').description('Sign in to Dexto');

        expect(rootHelpJson(program)).toEqual({
            usage: ['dexto [prompt]', 'dexto <command> [options]'],
            commands: [
                { name: 'run', summary: 'Run a single prompt', help: 'dexto run --help --json' },
                { name: 'login', summary: 'Sign in to Dexto', help: 'dexto login --help --json' },
            ],
            output: 'JSON when stdout isn\'t a terminal; failures as {"error":{"code","message","fix"}} on stderr.',
            exit_codes: {
                '0': 'done',
                '1': 'failed',
                '2': 'usage or invalid input',
                '3': 'needs sign-in or permission',
                '4': 'needs confirmation: pass --yes once your person has agreed',
                '5': 'not found',
                '6': 'waiting on a person, such as an approval',
            },
        });
    });
});
