/** An SSH session cannot send its loopback redirect to the person's browser. */
export function isSshSession(environment: Readonly<Record<string, string | undefined>>): boolean {
    return environment.SSH_CONNECTION !== undefined || environment.SSH_TTY !== undefined;
}
