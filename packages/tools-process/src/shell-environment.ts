/**
 * Environment passed to shell commands.
 *
 * Commands start from a small allowlist of the host environment. Provider keys, the server
 * key and every other host variable stay out unless the user configured them explicitly.
 */

const INHERITED_VARIABLES: ReadonlySet<string> = new Set([
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'LANG',
    'LANGUAGE',
    'TERM',
    'TMPDIR',
    // Windows needs these to start any process.
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'USERPROFILE',
    'TEMP',
    'TMP',
]);

function isInheritedVariable(name: string): boolean {
    const upper = name.toUpperCase();
    return INHERITED_VARIABLES.has(upper) || upper.startsWith('LC_');
}

export function buildShellEnvironment(
    hostVariables: Record<string, string | undefined>,
    ...explicit: Array<Record<string, string> | undefined>
): Record<string, string> {
    const variables: Record<string, string> = {};
    for (const [name, value] of Object.entries(hostVariables)) {
        if (value !== undefined && isInheritedVariable(name)) {
            variables[name] = value;
        }
    }
    for (const configured of explicit) {
        Object.assign(variables, configured);
    }
    return variables;
}
