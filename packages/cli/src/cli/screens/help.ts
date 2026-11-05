/**
 * The Signal `--help` (screen 7): letterspaced groups, each a command in `teal` and what it does
 * in `dim`. Behind DEXTO_PALETTE=signal; `--help --json` is unchanged.
 */
import type { Command, Help } from 'commander';
import { letterspaced, line, link, span, strong } from '@dexto/tui/signal-text';

export interface HelpRow {
    readonly term: string;
    readonly description: string;
}

export interface HelpSection {
    readonly title: string;
    readonly rows: readonly HelpRow[];
}

const TERM_CELLS = 12;

/** One term column for the whole page, so every section lines up. */
function termWidth(sections: readonly HelpSection[]): number {
    return Math.max(
        TERM_CELLS,
        ...sections.flatMap((section) => section.rows.map((row) => row.term.length + 2))
    );
}

function sectionLines(section: HelpSection, width: number): string[] {
    return [
        line([span('dim', `  ${letterspaced(section.title)}`)]),
        ...section.rows.map((row) =>
            line([span('teal', `  ${row.term.padEnd(width)}`), span('dim', row.description)])
        ),
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
export function rootHelpLines(program: Command, helper: Help, version: string): string[] {
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
    return [
        line([
            strong('hi', 'dexto'),
            span('faint', `  ${version}  `),
            span('fg', 'your agent harness, local and cloud'),
        ]),
        ...sections.flatMap((section) => ['', ...sectionLines(section, termWidth(sections))]),
        '',
        line([
            span('dim', '  help for one command: '),
            span('teal', 'dexto <command> --help'),
            span('dim', ' · '),
            link(DOCS_URL, DOCS_URL.replace('https://', '')),
        ]),
    ];
}

/** One command's help: its usage, what it does, then its sections in the same row format. */
export function pageHelpLines(
    usage: string,
    summary: string,
    sections: readonly HelpSection[]
): string[] {
    return [
        line([strong('hi', usage)]),
        ...(summary === '' ? [] : [line([span('fg', summary)])]),
        ...sections
            .filter((section) => section.rows.length > 0)
            .flatMap((section) => ['', ...sectionLines(section, termWidth(sections))]),
    ];
}

/** Commander's help for any command but the root, in the Signal rows. */
export function commanderHelpLines(command: Command, helper: Help): string[] {
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
        ]
    );
}
