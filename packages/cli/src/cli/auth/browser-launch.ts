// packages/cli/src/cli/auth/browser-launch.ts
// Environment checks for deciding whether automatic browser launch is likely to work.

export interface BrowserLaunchContext {
    env: NodeJS.ProcessEnv;
    platform: NodeJS.Platform;
}

const BROWSER_BLOCKLIST = new Set(['www-browser', 'none', 'false', '0']);
const DISPLAY_ENV_VARS = ['DISPLAY', 'WAYLAND_DISPLAY', 'MIR_SOCKET'] as const;

export function shouldAttemptBrowserLaunch(
    context: BrowserLaunchContext = { env: process.env, platform: process.platform }
): boolean {
    const browserEnv = context.env.BROWSER;
    if (browserEnv && BROWSER_BLOCKLIST.has(browserEnv.trim().toLowerCase())) {
        return false;
    }

    if (context.env.CI || context.env.DEBIAN_FRONTEND === 'noninteractive') {
        return false;
    }

    const isSshSession = Boolean(context.env.SSH_CONNECTION);

    if (context.platform === 'linux') {
        const hasDisplay = DISPLAY_ENV_VARS.some((name) => Boolean(context.env[name]));
        if (!hasDisplay) {
            return false;
        }
    }

    if (isSshSession && context.platform !== 'linux') {
        return false;
    }

    return true;
}
