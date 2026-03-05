/**
 * Parse an environment variable as a port number, with validation.
 * @param envVar - the string value from process.env
 * @param defaultPort - fallback port if envVar is undefined
 * @param varName - the name of the environment variable (used in error messages)
 * @returns a valid port number
 * @throws if envVar/defaultPort is not a valid port number
 */
export function getPort(envVar: string | undefined, defaultPort: number, varName: string): number {
    if (!Number.isInteger(defaultPort) || defaultPort <= 0 || defaultPort > 65535) {
        throw new Error(`Default port value "${defaultPort}" is not a valid port`);
    }

    if (envVar === undefined) {
        return defaultPort;
    }

    const rawPort = envVar.trim();
    const port = Number(rawPort);
    if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`Environment variable ${varName} value "${envVar}" is not a valid port`);
    }

    return port;
}
