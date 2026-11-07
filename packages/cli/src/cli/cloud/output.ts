// Prints API values: JSON for agents (--json, or stdout not a terminal), tables for people.
import chalk from 'chalk';
import { safeJson, safeText } from '@dexto/tui/signal-text';
import { jsonResult } from '../output.js';

import { safeLines, unfiltered, type CloudRuntime } from './runtime.js';

export interface Column<Row> {
    readonly header: string;
    readonly value: (row: Row) => string | number | boolean | null | undefined;
}

export interface Output {
    /** Whether records and lists print as JSON. */
    readonly json: boolean;
    /**
     * Whether content, such as a file, a command's output or a model's reply, prints as its JSON
     * record: only with an explicit --json, so piped content stays intact.
     */
    readonly jsonContent: boolean;
    /** A page of a list: a table, plus how to read the next page when there is one. */
    list<Row>(page: ListPage<Row>, columns: readonly Column<Row>[]): void;
    /** One resource: its fields, one per line. */
    record(value: unknown): void;
    /** A line for people; JSON output prints the value instead. */
    result(value: unknown, text: string): void;

    /** Progress and hints, on stderr so stdout stays parseable. */
    note(text: string): void;
}

/** A list, paged or not: some `/v1` lists return everything at once. */
export type ListPage<Row> =
    | { readonly data: readonly Row[] }
    | {
          readonly data: readonly Row[];
          readonly has_more: boolean;
          readonly next_after: string | number | null;
      };

/** `json` and `table` as asked; `auto` is tables at a terminal and JSON anywhere else. */
export type OutputFormat = 'auto' | 'json' | 'table';

export function createOutput(runtime: CloudRuntime, format: OutputFormat): Output {
    const json = format === 'json' || (format === 'auto' && !runtime.stdoutIsTerminal);
    const color = runtime.color;
    // Styled text, with every value cleaned here, so it skips the runtime's filter.
    const { writeError, writeOutput } = unfiltered(runtime);
    const printJson = (value: unknown): void => {
        writeOutput(jsonResult(value));
    };
    return {
        json,
        jsonContent: format === 'json',
        list(page, columns) {
            if (json) return printJson(page);
            if (page.data.length === 0) {
                writeOutput(`${dim('None.', color)}\n`);
                return;
            }
            writeOutput(renderTable(page.data, columns, color));
            if ('next_after' in page && page.has_more && page.next_after !== null)
                writeError(
                    `${dim(`More results: add --after ${safeText(String(page.next_after))}`, color)}\n`
                );
        },
        note(text) {
            writeError(`${dim(safeLines(text), color)}\n`);
        },
        record(value) {
            if (json) return printJson(value);
            writeOutput(renderRecord(value, color));
        },
        result(value, text) {
            if (json) return printJson(value);
            writeOutput(`${safeLines(text)}\n`);
        },
    };
}

function renderTable<Row>(
    rows: readonly Row[],
    columns: readonly Column<Row>[],
    color: boolean
): string {
    const cells = rows.map((row) => columns.map((column) => cell(column.value(row))));
    const widths = columns.map((column, index) =>
        Math.max(safeText(column.header).length, ...cells.map((row) => (row[index] ?? '').length))
    );
    const line = (values: readonly string[]) =>
        values
            .map((value, index) =>
                index === values.length - 1 ? value : value.padEnd(widths[index] ?? 0)
            )
            .join('  ')
            .trimEnd();
    const header = line(columns.map((column) => safeText(column.header).toUpperCase()));
    return `${color ? chalk.bold(header) : header}\n${cells.map(line).join('\n')}\n`;
}

/**
 * Top-level fields aligned; nested values as compact JSON. Keys and values come from the API, so
 * their control, bidi and invisible characters are taken out (or escaped, inside JSON).
 */
function renderRecord(value: unknown, color: boolean): string {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return `${safeJson(value, 2)}\n`;
    const entries = Object.entries(value).map(([key, field]): [string, unknown] => [
        safeText(key),
        field,
    ]);
    const width = Math.max(...entries.map(([key]) => key.length));
    return `${entries
        .map(([key, field]) => `${dim(key.padEnd(width), color)}  ${recordField(field)}`)
        .join('\n')}\n`;
}

function recordField(value: unknown): string {
    if (value === null) return '-';
    if (typeof value === 'string')
        return value.includes('\n') ? safeJson(value, 0) : safeText(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return safeJson(value, 0);
}

const MAX_CELL = 60;

function cell(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) return '-';
    const text = safeText(String(value)).replace(/\s+/gu, ' ');
    return text.length > MAX_CELL ? `${text.slice(0, MAX_CELL - 1)}…` : text;
}

function dim(text: string, color: boolean): string {
    return color ? chalk.dim(text) : text;
}
