/**
 * The Signal `--help` (screen 7): letterspaced groups, each a command in `teal` and what it does
 * in `dim`. Behind DEXTO_PALETTE=signal; `--help --json` is unchanged.
 */
import type { Command, Help } from 'commander';
import {
    drawnWidth,
    letterspaced,
    line,
    link,
    span,
    spansWidth,
    strong,
} from '@dexto/tui/signal-text';

export interface HelpRow {
    readonly term: string;
    readonly description: string;
}

export interface HelpSection {
    readonly title: string;
    readonly rows: readonly HelpRow[];
}

const TERM_CELLS = 12;
const INDENT = 2;

/** The width help is drawn to: the terminal's, or 80 when stdout isn't one. */
export function helpColumns(): number {
    return process.stdout.columns || 80;
}

/**
 * One term column for the whole page, so every section lines up. It takes at most half the
 * row; a longer term gets a row of its own, with its description under the column.
 */
function termWidth(sections: readonly HelpSection[], columns: number): number {
    const widest = Math.max(
        TERM_CELLS,
        ...sections.flatMap((section) => section.rows.map((row) => drawnWidth(row.term) + 2))
    );
    return Math.min(widest, Math.max(TERM_CELLS, Math.floor((columns - INDENT) / 2)));
}

/** `text` in rows no wider than `width`, broken between words; a longer word is cut. */
export function wrapWords(text: string, width: number): string[] {
    const cells = Math.max(1, width);
    const rows: string[] = [];
    let row = '';
    for (const word of text.split(/\s+/u).filter((each) => each !== '')) {
        let rest = word;
        while (drawnWidth(rest) > cells) {
            if (row !== '') rows.push(row);
            row = '';
            const chars = [...rest];
            let cut = '';
            while (chars.length > 0 && drawnWidth(cut + chars[0]) <= cells) cut += chars.shift();
            if (cut === '') cut = chars.shift() ?? '';
            rows.push(cut);
            rest = chars.join('');
        }
        if (rest === '') continue;
        if (row === '') row = rest;
        else if (drawnWidth(row) + 1 + drawnWidth(rest) <= cells) row = `${row} ${rest}`;
        else {
            rows.push(row);
            row = rest;
        }
    }
    if (row !== '' || rows.length === 0) rows.push(row);
    return rows;
}

/** A command and what it does; the words wrap under the description column to fit `columns`. */
function rowLines(row: HelpRow, width: number, columns: number): string[] {
    const under = ' '.repeat(INDENT + width);
    const words = wrapWords(row.description, columns - INDENT - width);
    const fits = drawnWidth(row.term) + 2 <= width;
    const first = fits
        ? [
              line([
                  span('teal', `${' '.repeat(INDENT)}${row.term.padEnd(width)}`),
                  span('dim', words[0] ?? ''),
              ]),
          ]
        : [line([span('teal', `${' '.repeat(INDENT)}${row.term}`)])];
    const rest = fits ? words.slice(1) : words;
    return [...first, ...rest.map((each) => line([span('dim', `${under}${each}`)]))];
}

function sectionLines(section: HelpSection, width: number, columns: number): string[] {
    return [
        line([span('dim', `${' '.repeat(INDENT)}${letterspaced(section.title)}`)]),
        ...section.rows.flatMap((row) => rowLines(row, width, columns)),
    ];
}

export const DOCS_URL = 'https://cli.dexto.ai';

/** The words a command line starts with; anything not listed goes under More. */
const ROOT_GROUPS: readonly { readonly title: string; readonly names: readonly string[] }[] = [
    { title: 'start', names: ['run'] },
    { title: 'chat', names: ['chat'] },
    {
        title: 'cloud',
        names: [
            'publish',
            'cloud',
            'workspace',
            'find',
            'skills',
            'profile',
            'models',
            'billing',
            'trace',
            'span',
        ],
    },
    { title: 'account', names: ['login', 'whoami', 'logout', 'accounts'] },
];

/** `dexto`, `-c` and `-r`: what the bare command does, before the subcommands. */
const START_ROWS: readonly HelpRow[] = [
    { term: 'dexto', description: 'Start the agent here, in this folder' },
    { term: 'dexto -c', description: 'Continue the most recent chat' },
    { term: 'dexto -r <id>', description: 'Resume a chat by id' },
];

/** Options the commands read themselves, which Commander doesn't list on the root. */
const COMMAND_OPTION_ROWS: readonly HelpRow[] = [
    { term: '--json', description: "Print JSON; the default when stdout isn't a terminal" },
    { term: '--stream-json', description: 'dexto run: JSON events, one per line' },
    { term: '--profile', description: 'Use a saved sign-in for one run' },
];

/** `dexto --help`: the real commands, grouped. */
export function rootHelpLines(
    program: Command,
    helper: Help,
    version: string,
    columns: number = helpColumns()
): string[] {
    const commands = helper.visibleCommands(program).filter((each) => each.name() !== 'help');
    const row = (each: Command): HelpRow => ({
        term: each.name(),
        description: each.description(),
    });
    const grouped = new Set(ROOT_GROUPS.flatMap((group) => group.names));
    const sections: HelpSection[] = ROOT_GROUPS.map((group) => ({
        title: group.title,
        rows: [
            ...(group.title === 'start' ? START_ROWS : []),
            ...group.names.flatMap((name) => {
                const found = commands.find((each) => each.name() === name);
                return found === undefined ? [] : [row(found)];
            }),
        ],
    }));
    sections.push({
        title: 'local',
        rows: commands.filter((each) => !grouped.has(each.name())).map(row),
    });
    sections.push({
        title: 'options',
        rows: [
            ...COMMAND_OPTION_ROWS,
            ...helper.visibleOptions(program).map((each) => ({
                term: helper.optionTerm(each),
                description: helper.optionDescription(each),
            })),
        ],
    });
    const title = [strong('hi', 'dexto'), span('faint', `  ${version}`)];
    const tagline = span('fg', 'your agent harness, local and cloud');
    const helpFor = [
        span('dim', '  help for one command: '),
        span('teal', 'dexto <command> --help'),
    ];
    const docs = link(DOCS_URL, DOCS_URL.replace('https://', ''));
    return [
        // Each of these two rows breaks where it has a gap when it doesn't fit.
        ...(spansWidth([...title, span('faint', '  '), tagline]) <= columns
            ? [line([...title.slice(0, 1), span('faint', `  ${version}  `), tagline])]
            : [line(title), line([tagline])]),
        ...sections.flatMap((section) => [
            '',
            ...sectionLines(section, termWidth(sections, columns), columns),
        ]),
        '',
        ...(spansWidth([...helpFor, span('dim', ' · '), docs]) <= columns
            ? [line([...helpFor, span('dim', ' · '), docs])]
            : [
                  ...(spansWidth(helpFor) <= columns
                      ? [line(helpFor)]
                      : [
                            line(helpFor.slice(0, 1)),
                            line([span('teal', '  '), ...helpFor.slice(1)]),
                        ]),
                  line([span('dim', '  '), docs]),
              ]),
    ];
}

/** One command's help: its usage, what it does, then its sections in the same row format. */
export function pageHelpLines(
    usage: string,
    summary: string,
    sections: readonly HelpSection[],
    columns: number = helpColumns()
): string[] {
    return [
        line([strong('hi', usage)]),
        ...(summary === '' ? [] : [line([span('fg', summary)])]),
        ...sections
            .filter((section) => section.rows.length > 0)
            .flatMap((section) => [
                '',
                ...sectionLines(section, termWidth(sections, columns), columns),
            ]),
    ];
}

/** Commander's help for any command but the root, in the Signal rows. */
export function commanderHelpLines(
    command: Command,
    helper: Help,
    columns: number = helpColumns()
): string[] {
    return pageHelpLines(
        `dexto ${helper.commandUsage(command).replace(/^dexto /u, '')}`,
        helper.commandDescription(command),
        [
            {
                title: 'arguments',
                rows: helper.visibleArguments(command).map((each) => ({
                    term: helper.argumentTerm(each),
                    description: helper.argumentDescription(each),
                })),
            },
            {
                title: 'commands',
                rows: helper.visibleCommands(command).map((each) => ({
                    term: helper.subcommandTerm(each),
                    description: helper.subcommandDescription(each),
                })),
            },
            {
                title: 'options',
                rows: helper.visibleOptions(command).map((each) => ({
                    term: helper.optionTerm(each),
                    description: helper.optionDescription(each),
                })),
            },
        ],
        columns
    );
}
