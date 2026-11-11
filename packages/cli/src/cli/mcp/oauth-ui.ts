import chalk from 'chalk';

export async function openAuthUrl(url: string): Promise<void> {
    const { protocol } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') {
        throw new Error(`Refusing to open an authorization URL that is not http(s): ${protocol}`);
    }

    console.log(chalk.cyan('🌐 Opening browser for MCP authentication...'));

    try {
        const { default: open } = await import('open');
        await open(url, { wait: false });
        console.log(chalk.green('✅ Browser opened'));
    } catch (_error) {
        console.log(chalk.yellow(`💡 Please open manually: ${url}`));
    }
}
