/**
 * `tone(role)` for text coloured with chalk rather than an Ink prop: the exit summary written
 * straight to stdout, /help, and wrapped markdown.
 */
import chalk, { foregroundColorNames, type ChalkInstance, type ForegroundColorName } from 'chalk';
import { getCaps } from './caps.js';
import { tone, type Role } from './tone.js';

function isColorName(color: string): color is ForegroundColorName {
    return (foregroundColorNames as readonly string[]).includes(color);
}

/** The chalk for a value `tone` returned: hex, a colour name, or '' for the terminal default. */
function chalkForTone(color: string): ChalkInstance {
    if (color.startsWith('#')) return chalk.hex(color);
    return isColorName(color) ? chalk[color] : chalk;
}

/** The chalk for a role in this terminal. Reads caps on each call, so call it at draw time. */
export function paint(role: Role): ChalkInstance {
    return chalkForTone(tone(role));
}

/**
 * The chalk for wrapped markdown, given the Ink colour the same text has when unwrapped.
 * Markdown has its own name mapping on the legacy palette, kept so nothing there changes.
 * Removed when the Signal palette becomes the default.
 */
export function markdownChalk(color: string): ChalkInstance {
    if (getCaps().palette === 'signal' || color === '' || color.startsWith('#')) {
        return chalkForTone(color);
    }
    switch (color) {
        case 'gray':
            return chalk.gray;
        case 'blue':
            return chalk.blue;
        case 'cyan':
            return chalk.cyan;
        case 'green':
            return chalk.green;
        case 'yellow':
        case 'orange':
            return chalk.rgb(255, 165, 0);
        case 'red':
            return chalk.red;
        case 'magenta':
            return chalk.green;
        default:
            return chalk.white;
    }
}
