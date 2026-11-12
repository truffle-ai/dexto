import type { Command } from './command.js';

/**
 * Commands built but held out of the 2.0 release, by their words. Each comes back by deleting its
 * line once its gate clears; until then it is not registered, so it is neither in help nor runnable.
 */
export const HELD_COMMANDS: ReadonlySet<string> = new Set([
    // Uploads the working tree to a cloud computer: ships in 2.1 with chat sync on by default
    // (DEXTO-2043). /cloud and /local in the interactive CLI are held with it.
    'chat move',
    // Any catalog connector: needs the cloud connector route deployed first (DEXTO-2755).
    // `connect claude` and `connect codex` already work and stay.
    'connect',
]);

export function isHeld(command: Command): boolean {
    return HELD_COMMANDS.has(command.path.join(' '));
}
