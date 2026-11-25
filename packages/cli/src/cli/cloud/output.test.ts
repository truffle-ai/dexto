import { describe, expect, it } from 'vitest';
import { createOutput, jsonKeys, printedSchema } from './output.js';
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

function jsonOutput() {
    let stdout = '';
    const runtime = {
        ...nodeCloudRuntime(new AbortController().signal),
        stdoutIsTerminal: false,
        writeOutput: (text: string) => {
            stdout += text;
        },
    };
    return { output: createOutput(runtime, 'json'), json: (): unknown => JSON.parse(stdout) };
}

describe('jsonKeys', () => {
    it('turns camelCase keys into snake_case, nested and in lists', () => {
        expect(
            jsonKeys({
                activeRunId: 'r',
                items: [{ updatedAt: 't', htmlURL: 'u', contextOver200kPerM: 1 }],
                pagination: { nextCursor: null },
            })
        ).toEqual({
            active_run_id: 'r',
            items: [{ updated_at: 't', html_url: 'u', context_over200k_per_m: 1 }],
            pagination: { next_cursor: null },
        });
    });

    it('leaves keys that are not camelCase words as they are', () => {
        expect(jsonKeys({ 'dexto/app': 1, 'Content-Type': 2, MY_VAR: 3, 'a.b': 4 })).toEqual({
            'dexto/app': 1,
            'Content-Type': 2,
            MY_VAR: 3,
            'a.b': 4,
        });
    });

    it("keeps the keys inside someone's data: schemas, tool input, metadata and record values", () => {
        const schema = { properties: { attemptId: { type: 'string' } }, required: ['attemptId'] };
        expect(
            jsonKeys({
                _meta: { appKind: 'x' },
                inputSchema: schema,
                nextAction: { tool: 't', arguments: { attemptId: 'a' } },
                records: [{ createdAt: 'c', value: { firstName: 'Ada' } }],
                record: { data: { firstName: 'Ada' } },
                rows: { data: [{ firstName: 'Ada' }] },
            })
        ).toEqual({
            _meta: { appKind: 'x' },
            input_schema: schema,
            next_action: { tool: 't', arguments: { attemptId: 'a' } },
            records: [{ created_at: 'c', value: { firstName: 'Ada' } }],
            record: { data: { firstName: 'Ada' } },
            rows: { data: [{ first_name: 'Ada' }] },
        });
    });
});

describe('printedSchema', () => {
    it("names a help schema's properties as the JSON prints them", () => {
        expect(
            printedSchema({
                description: 'Balance.',
                schema: {
                    properties: { creditsUsd: { type: 'number' } },
                    required: ['creditsUsd'],
                    type: 'object',
                },
            })
        ).toEqual({
            description: 'Balance.',
            schema: {
                properties: { credits_usd: { type: 'number' } },
                required: ['credits_usd'],
                type: 'object',
            },
        });
    });
});

describe('createOutput for agents', () => {
    it('prints every key snake_case', () => {
        const { output, json } = jsonOutput();
        output.list({ data: [{ updatedAt: 't' }], has_more: true, next_after: 'c' }, []);
        expect(json()).toEqual({ data: [{ updated_at: 't' }], has_more: true, next_after: 'c' });
    });

    it('prints a list that is not paged with has_more false and next_after null', () => {
        const { output, json } = jsonOutput();
        output.list({ data: [{ id: 'a' }] }, []);
        expect(json()).toEqual({ data: [{ id: 'a' }], has_more: false, next_after: null });
    });

    it("keeps a page's other facts beside data and drops the second cursor name", () => {
        const { output, json } = jsonOutput();
        output.list(
            {
                data: [],
                deployments: [{ id: 'd' }],
                has_more: true,
                next_after: 'c2',
                next_cursor: 'c2',
                object: 'list',
            },
            []
        );
        expect(json()).toEqual({
            data: [],
            deployments: [{ id: 'd' }],
            has_more: true,
            next_after: 'c2',
            object: 'list',
        });
    });
});
