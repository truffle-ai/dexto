import { Command, Option } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeUsageErrors } from './usage-errors.js';

/** The shape of the real tree: a root that takes no words, and `chat` with its verbs. */
function program(): Command {
    const root = new Command('dexto')
        .addOption(new Option('--json').hideHelp())
        .enablePositionalOptions()
        .action(() => {});
    const chat = root.command('chat').description('Your local and cloud chats');
    chat.command('history')
        .argument('[sessionId]')
        .action(() => {});
    chat.command('delete')
        .argument('<sessionId>')
        .action(() => {});
    root.command('upgrade [version]')
        .option('--dry-run')
        .action(() => {});
    return root;
}

/** Parses `args`, returning what went to stderr and the exit code. */
async function run(args: string[], json: boolean): Promise<{ stderr: string; code: number }> {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        stderr.push(String(chunk));
        return true;
    });
    vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Exit(Number(code));
    });
    const root = program();
    routeUsageErrors(root, json);
    try {
        await root.parseAsync(['node', 'dexto', ...args]);
    } catch (error) {
        if (error instanceof Exit) return { stderr: stderr.join(''), code: error.code };
        throw error;
    }
    return { stderr: stderr.join(''), code: 0 };
}

class Exit extends Error {
    constructor(readonly code: number) {
        super(`exit ${code}`);
    }
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Commander usage errors', () => {
    it.each([
        [['--bogus'], "Unknown option '--bogus'", 'dexto --help'],
        [['chat', 'bogus', '--json'], "Unknown command 'bogus'", 'dexto chat --help'],
        [['chat', 'delete'], "Missing required argument 'sessionId'", 'dexto chat delete --help'],
        [['upgrade', '--bogus'], "Unknown option '--bogus'", 'dexto upgrade --help'],
    ])('dexto %j is a JSON usage error with the help that fixes it', async (args, message, fix) => {
        const { stderr, code } = await run(args, true);

        expect(code).toBe(2);
        expect(JSON.parse(stderr)).toEqual({ error: { code: 'usage', message, fix } });
    });

    it("keeps Commander's suggestion on the message's one line", async () => {
        const { stderr } = await run(['chat', 'delet'], true);

        expect(JSON.parse(stderr)).toEqual({
            error: {
                code: 'usage',
                message: "Unknown command 'delet' (Did you mean delete?)",
                fix: 'dexto chat --help',
            },
        });
    });

    it("prints Commander's text at a terminal, still exiting 2", async () => {
        const { stderr, code } = await run(['chat', 'delete'], false);

        expect(code).toBe(2);
        expect(stderr).toBe("error: missing required argument 'sessionId'\n");
    });

    it('lets the root take --json, so its own stray-word check reports the word', async () => {
        expect(await run(['bogus', '--json'], true)).toEqual({ stderr: '', code: 0 });
    });
});
