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
