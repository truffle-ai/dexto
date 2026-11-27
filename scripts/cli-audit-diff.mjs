// The base revision prevents a rewritten working baseline from hiding regressions.
export function exampleRegressions(base, expected, actual, pending) {
    const before = new Map(base.map((row) => [row.command, row]));
    const recorded = new Map(expected.map((row) => [row.command, row]));
    const grandfathered = new Set(pending);
    const regressions = [];
    for (const row of actual) {
        if (row.examples === true) continue;
        const oldRow = before.get(row.command);
        if (oldRow?.examples === true || recorded.get(row.command)?.examples === true) {
            regressions.push(`REGRESSION ${row.command}: examples true -> false`);
        } else if (!oldRow && !grandfathered.has(row.command)) {
            regressions.push(`REGRESSION ${row.command}: new command has no examples`);
        }
    }
    return regressions;
}

export function auditDiff(expected, actual) {
    const before = new Map(expected.map((row) => [row.command, row]));
    const after = new Map(actual.map((row) => [row.command, row]));
    const changes = [];
    for (const [name, oldRow] of before) {
        const newRow = after.get(name);
        if (!newRow) {
            changes.push(`REMOVED ${name}`);
            continue;
        }
        for (const key of new Set([...Object.keys(oldRow), ...Object.keys(newRow)])) {
            if (key === 'command' || oldRow[key] === newRow[key]) continue;
            const kind = oldRow[key] === true && newRow[key] === false ? 'REGRESSION' : 'CHANGED';
            changes.push(`${kind} ${name}: ${key} ${oldRow[key]} -> ${newRow[key]}`);
        }
    }
    for (const name of after.keys()) if (!before.has(name)) changes.push(`ADDED ${name}`);
    return changes;
}
