import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { drawText } from '@dexto/tui/signal-harness';
import { commanderHelpLines, rootHelpLines } from './help.js';

/**
 * The Signal help as index-main installs it: `configureHelp` on the root, before the commands
 * are added, with the root drawn by `rootHelpLines` and every other command by
 * `commanderHelpLines`. index-main runs the CLI on import, so this mirrors its wiring.
 */
function signalProgram(): Command {
    const program = new Command('dexto').option('--model <id>', 'Specify the LLM model to use');
    program.configureHelp({
        formatHelp: (command, helper) =>
            `${(command === program ? rootHelpLines(program, helper, '2.0.0') : commanderHelpLines(command, helper)).join('\n')}\n`,
    });
    program
        .command('login')
        .description('Sign in to Dexto with your browser or a device code')
        .argument('[profile]', 'The profile to save it under')
        .option('--device', 'Sign in with a code on any device');
    const accounts = program.command('accounts').description('Your saved sign-ins');
    accounts.command('use <profile>').description('Use a saved sign-in from now on');
    return program;
}

const subcommand = (program: Command, name: string): Command => {
    const found = program.commands.find((each) => each.name() === name);
    if (found === undefined) throw new Error(`no ${name}`);
    return found;
};

describe('Signal help through Commander', () => {
    it('draws the root with its groups and options', () => {
        const program = signalProgram();
        const out = drawText('no-color', () => [program.helpInformation()]);

        expect(out).not.toContain('Usage:');
        expect(out).toMatch(/^dexto {2}2\.0\.0 {2}your agent harness/u);
        expect(out).toContain('  A C C O U N T');
        expect(out).toMatch(/ {2}login\s+Sign in to Dexto with your browser or a device code/u);
        expect(out).toContain('  O P T I O N S');
        expect(out).toMatch(/--model <id>\s+Specify the LLM model to use/u);
    });

    it('carries over to commands added after it, at every depth', () => {
        const program = signalProgram();
        const login = drawText('no-color', () => [subcommand(program, 'login').helpInformation()]);

        expect(login).not.toContain('Usage:');
        expect(login.split('\n').slice(0, 2)).toEqual([
            'dexto login [options] [profile]',
            'Sign in to Dexto with your browser or a device code',
        ]);
        expect(login).toContain('  A R G U M E N T S');
        expect(login).toMatch(/ {2}profile\s+The profile to save it under/u);
        expect(login).toContain('  O P T I O N S');
        expect(login).toMatch(/--device\s+Sign in with a code on any device/u);

        const accounts = subcommand(program, 'accounts');
        const group = drawText('no-color', () => [accounts.helpInformation()]);
        expect(group).toContain('  C O M M A N D S');
        expect(group).toMatch(/use <profile>\s+Use a saved sign-in from now on/u);

        const use = drawText('no-color', () => [subcommand(accounts, 'use').helpInformation()]);
        expect(use.split('\n')[0]).toBe('dexto accounts use [options] <profile>');
    });
});
