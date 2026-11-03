import type { Command } from 'commander';

export interface AuditRow {
    command: string;
    json: boolean;
    dryRun: boolean;
    nonInteractiveFlag: boolean;
    examples: boolean;
}

export function auditCommander(program: Command): AuditRow[] {
    const rows: AuditRow[] = [];
    function visit(command: Command, path: string[]): void {
        const words = [...path, command.name()];
        if (typeof Reflect.get(command, '_actionHandler') === 'function') {
            const options = command.options.map((option) => option.long);
            let help = '';
            command.configureOutput({
                writeOut: (text) => {
                    help += text;
                },
            });
            command.outputHelp();
            rows.push({
                command: words.join(' '),
                json: options.includes('--json'),
                dryRun: options.includes('--dry-run'),
                nonInteractiveFlag:
                    options.includes('--no-interactive') ||
                    options.includes('--non-interactive') ||
                    options.includes('--yes'),
                examples: /examples:/iu.test(help),
            });
        }
        for (const child of command.commands) visit(child, words);
    }
    for (const command of program.commands) visit(command, []);
    return rows;
}

export function auditCloud(commands: readonly import('./cloud/command.js').Command[]): AuditRow[] {
    return commands.map((command) => ({
        command: command.path.join(' '),
        json: true,
        dryRun: 'dry-run' in (command.options ?? {}),
        nonInteractiveFlag: 'yes' in (command.options ?? {}),
        examples: false,
    }));
}
