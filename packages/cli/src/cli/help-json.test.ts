import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { isRootJsonHelp, rootHelpJson } from './help-json.js';

describe('dexto --help --json', () => {
    it('is asked for with --help (or -h) and --json, and nothing else', () => {
        expect(isRootJsonHelp(['--help', '--json'])).toBe(true);
        expect(isRootJsonHelp(['--json', '-h'])).toBe(true);
        expect(isRootJsonHelp(['--help'])).toBe(false);
        expect(isRootJsonHelp(['cloud', '--help', '--json'])).toBe(false);
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
