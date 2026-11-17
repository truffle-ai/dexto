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
            const output = { ...command.configureOutput() };
            command.configureOutput({
                writeOut: (text) => {
                    help += text;
                },
            });
            try {
                command.outputHelp();
            } finally {
                command.configureOutput(output);
            }
            rows.push({
                command: words.join(' '),
                json: options.includes('--json'),
                dryRun: options.includes('--dry-run'),
                nonInteractiveFlag:
                    options.includes('--no-interactive') ||
                    options.includes('--non-interactive') ||
                    options.includes('--yes'),
                examples: /^\s*examples:\s*$/imu.test(help),
            });
        }
        for (const child of command.commands) visit(child, words);
    }
    for (const command of program.commands) visit(command, []);
    return rows;
}

// JSON is an engine-wide option; inspect examples declared by each cloud command.
export function auditCloud(commands: readonly import('./cloud/command.js').Command[]): AuditRow[] {
    return commands.map((command) => ({
        command: command.path.join(' '),
        json: true,
        dryRun: 'dry-run' in (command.options ?? {}),
        nonInteractiveFlag: 'yes' in (command.options ?? {}),
        examples: (command.examples?.length ?? 0) > 0,
    }));
}

export function auditProgram(
    program: Command,
    commands: readonly import('./cloud/command.js').Command[]
): AuditRow[] {
    const cloud = auditCloud(commands);
    const cloudNames = cloud.map((row) => row.command);
    const local = auditCommander(program).filter(
        (row) =>
            !cloudNames.some((name) => name === row.command || name.startsWith(`${row.command} `))
    );
    return [...local, ...cloud].sort((a, b) =>
        a.command < b.command ? -1 : a.command > b.command ? 1 : 0
    );
}
