/**
 * Environment passed to shell commands.
 *
 * Commands start from a small allowlist of the host environment. Provider keys, the server
 * key, credentials such as GH_TOKEN or SSH_AUTH_SOCK, and every other host variable stay out
 * unless the user configured them explicitly.
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
    'COLORTERM',
    'TMPDIR',
    'TZ',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'CURL_CA_BUNDLE',
    'REQUESTS_CA_BUNDLE',
    'NODE_EXTRA_CA_CERTS',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    // Windows needs these to start and run ordinary processes.
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'USERNAME',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'PROGRAMFILES',
    'PROGRAMFILES(X86)',
    'PROGRAMDATA',
    'ALLUSERSPROFILE',
    'PROCESSOR_ARCHITECTURE',
    'TEMP',
    'TMP',
]);

const INHERITED_PREFIXES: readonly string[] = ['LC_', 'XDG_'];

function isInheritedVariable(name: string): boolean {
    const upper = name.toUpperCase();
    return INHERITED_VARIABLES.has(upper) || INHERITED_PREFIXES.some((p) => upper.startsWith(p));
}

type HostVariables = Record<string, string | undefined>;

/**
 * The allowlisted host variables, followed by each explicit layer in order (later layers win).
 */
export function buildShellEnvironment(
    hostVariables: HostVariables,
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

/**
 * The named host variables that are set, for forwarding past the allowlist on request.
 */
export function pickHostVariables(
    hostVariables: HostVariables,
    names: readonly string[]
): Record<string, string> {
    const picked: Record<string, string> = {};
    for (const name of names) {
        const value = hostVariables[name];
        if (value !== undefined) {
            picked[name] = value;
        }
    }
    return picked;
}
