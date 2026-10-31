// Setting this machine up for Dexto models: whether they can run, and signing in so they can.

export { canUseDextoProvider } from '@dexto/agent-management';

/**
 * Signs in to Dexto asking to spend credits (`cloud:write`), as choosing Dexto models needs. A
 * sign-in that only reads keeps what it had and gains that.
 */
export async function signInForDextoModels(): Promise<void> {
    const [{ login }, { nodeSignInContext }] = await Promise.all([
        import('../commands/auth/sign-in-commands.js'),
        import('../commands/auth/sign-in-context.js'),
    ]);
    await login(await nodeSignInContext(), {
        profile: null,
        org: null,
        device: false,
        browser: true,
        scopes: ['cloud:write'],
        apiKey: null,
    });
}
