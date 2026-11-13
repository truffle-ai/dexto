import { describe, expect, it } from 'vitest';
import { createOutput } from './output.js';
import { nodeCloudRuntime } from './runtime.js';

const ESC = '\u001B';
const BEL = '\u0007';
const C1_CSI = '\u009B';
// ESC[2J clears the screen, OSC 0 sets the window title, and CSI as one C1 character sets a colour.
const HOSTILE = `Evil${ESC}[2J Org${ESC}]0;pwned${BEL} ${C1_CSI}31mInc\u202Etxt`;
// eslint-disable-next-line no-control-regex
const RAW = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B\u202E]/u;

function tableOutput() {
    let stdout = '';
    let stderr = '';
    const runtime = {
        ...nodeCloudRuntime(new AbortController().signal),
        color: false,
        stdoutIsTerminal: true,
        writeOutput: (text: string) => {
            stdout += text;
        },
        writeError: (text: string) => {
            stderr += text;
        },
    };
    return { output: createOutput(runtime, 'table'), stdout: () => stdout, stderr: () => stderr };
}

describe('createOutput for people', () => {
    it('prints table cells with no control, bidi or invisible characters', () => {
        const { output, stdout, stderr } = tableOutput();
        output.list(
            { data: [{ id: 'p_1', name: HOSTILE }], has_more: true, next_after: `c${ESC}[2J` },
            [
                { header: 'id', value: (row) => row.id },
                { header: 'name', value: (row) => row.name },
            ]
        );
        expect(stdout()).not.toMatch(RAW);
        expect(stdout()).toContain('p_1  Evil[2J Org]0;pwned 31mInctxt');
        expect(stderr()).not.toMatch(RAW);
        expect(stderr()).toContain('--after c[2J');
    });

    it('prints record keys and values with no control, bidi or invisible characters', () => {
        const { output, stdout } = tableOutput();
        output.record({
            [`na${ESC}]0;x${BEL}me`]: HOSTILE,
            multi: `one\n${HOSTILE}`,
            nested: { [`k${C1_CSI}`]: [`\u2066${HOSTILE}\u2069`] },
            count: 2,
        });
        const printed = stdout();
        expect(printed).not.toMatch(RAW);
        expect(printed).toContain('na]0;xme  Evil[2J Org]0;pwned 31mInctxt');
        // Values that print as JSON keep their characters, escaped.
        expect(printed).toContain('"one\\nEvil\\u001b[2J Org\\u001b]0;pwned\\u0007 \\u009B31m');
        expect(printed).toContain('{"k\\u009B":["\\u2066Evil');
        expect(printed).toContain('count     2');
    });

    it('prints a record that is not an object as escaped JSON', () => {
        const { output, stdout } = tableOutput();
        output.record([HOSTILE]);
        expect(stdout()).not.toMatch(RAW);
        expect(JSON.parse(stdout())).toEqual([HOSTILE]);
    });

    it('prints notes and results with no control characters, keeping their lines', () => {
        const { output, stdout, stderr } = tableOutput();
        output.result({ id: 'a_1' }, `Created agent a_1 (${HOSTILE}).\nNext: dexto run`);
        output.note(`Session ${HOSTILE}`);
        expect(stdout()).toBe(
            'Created agent a_1 (Evil[2J Org]0;pwned 31mInctxt).\nNext: dexto run\n'
        );
        expect(stderr()).toBe('Session Evil[2J Org]0;pwned 31mInctxt\n');
    });
});
