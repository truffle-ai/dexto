/**
 * A unified diff on the Signal look: hunk headers on a dotted rule, old and new line numbers,
 * added and removed lines on a tint that fills the row, changed words on a stronger tint.
 * A line too long for the row wraps: approvals are decided on this text, so none may be hidden.
 */
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import type { DiffDisplayData } from '@dexto/core';
import { glyphText, useCaps, useTone, type Role } from '../../signal/index.js';
import {
    computeWordDiff,
    parseUnifiedDiff,
    type ParsedHunk,
    type WordDiffPart,
} from './diff-shared.js';

export interface DiffRow {
    kind: 'context' | 'addition' | 'deletion';
    oldLine: number | null;
    newLine: number | null;
    content: string;
    /** Word-level parts, when this line is one side of a change. */
    parts: WordDiffPart[] | null;
}

/** One hunk's rows, each with both line numbers, and word diffs across a -/+ pair. */
export function diffRows(hunk: ParsedHunk): DiffRow[] {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    const rows: DiffRow[] = hunk.lines.map((line) => ({
        kind: line.type,
        oldLine: line.type === 'addition' ? null : oldLine++,
        newLine: line.type === 'deletion' ? null : newLine++,
        content: line.content,
        parts: null,
    }));
    rows.forEach((row, i) => {
        const next = rows[i + 1];
        if (row.kind !== 'deletion' || next?.kind !== 'addition') return;
        const { oldParts, newParts } = computeWordDiff(row.content, next.content);
        row.parts = oldParts;
        next.parts = newParts;
    });
    return rows;
}

const MIN_NUMBER_CELLS = 4;

/** Cells for a line number: wide enough for the largest in the diff, the same on every row. */
export function numberCells(hunks: ParsedHunk[]): number {
    const largest = hunks
        .flatMap((hunk) => diffRows(hunk))
        .flatMap((row) => [row.oldLine ?? 0, row.newLine ?? 0])
        .reduce((a, b) => Math.max(a, b), 0);
    return Math.max(MIN_NUMBER_CELLS, String(largest).length);
}

/** Two line numbers, a space after each, the sign and a space. */
function gutterCells(cells: number): number {
    return cells * 2 + 4;
}

function cell(line: number | null, cells: number): string {
    return (line === null ? '' : String(line)).padStart(cells, ' ');
}

const ROW_STYLE: Readonly<
    Record<DiffRow['kind'], { bg: Role | null; strong: Role | null; sign: string; role: Role }>
> = {
    addition: { bg: 'addBg', strong: 'addBg2', sign: '+', role: 'add' },
    deletion: { bg: 'delBg', strong: 'delBg2', sign: '−', role: 'del' },
    context: { bg: null, strong: null, sign: ' ', role: 'dim' },
};

function RowText({ row, width, cells }: { row: DiffRow; width: number; cells: number }) {
    const tone = useTone();
    const { glyphs } = useCaps();
    const style = ROW_STYLE[row.kind];
    const bg = style.bg === null ? {} : { backgroundColor: tone(style.bg) };
    const parts = (row.parts ?? [{ value: row.content }]).map((part) => ({
        ...part,
        value: part.value.replace(/\t/g, '    '),
    }));
    const gutter = gutterCells(cells);
    const room = Math.max(1, width - gutter);
    const used = stringWidth(parts.map((part) => part.value).join(''));
    return (
        <Box>
            <Box width={gutter} flexShrink={0}>
                <Text {...bg}>
                    <Text
                        color={tone('faint')}
                    >{`${cell(row.oldLine, cells)} ${cell(row.newLine, cells)} `}</Text>
                    <Text bold color={tone(style.role)}>
                        {glyphText(style.sign, glyphs)}{' '}
                    </Text>
                </Text>
            </Box>
            <Box width={room} flexShrink={0}>
                <Text wrap="wrap" {...bg}>
                    {parts.map((part, i) => {
                        const strong = part.added || part.removed ? style.strong : null;
                        return (
                            <Text
                                key={i}
                                color={tone(
                                    strong !== null ? 'hi' : row.kind === 'context' ? 'dim' : 'fg'
                                )}
                                {...(strong !== null ? { backgroundColor: tone(strong) } : {})}
                            >
                                {part.value}
                            </Text>
                        );
                    })}
                    {style.bg !== null && used < room ? ' '.repeat(room - used) : ''}
                </Text>
            </Box>
        </Box>
    );
}

export interface SignalDiffProps {
    data: DiffDisplayData;
    /** Columns the diff may fill. */
    width: number;
}

export function SignalDiff({ data, width }: SignalDiffProps) {
    const tone = useTone();
    const { glyphs } = useCaps();
    const hunks = parseUnifiedDiff(data.unified);
    const cells = numberCells(hunks);
    return (
        <Box flexDirection="column">
            {hunks.map((hunk, h) => (
                <Box key={h} flexDirection="column">
                    <Text wrap="truncate-end">
                        <Text color={tone('ghost')}>{glyphText('┊ ', glyphs)}</Text>
                        <Text color={tone('tealDim')}>
                            {glyphText(hunk.header.replace(/ -(\d)/, ' −$1'), glyphs)}
                        </Text>
                    </Text>
                    {diffRows(hunk).map((row, i) => (
                        <RowText key={i} row={row} width={width} cells={cells} />
                    ))}
                </Box>
            ))}
        </Box>
    );
}
