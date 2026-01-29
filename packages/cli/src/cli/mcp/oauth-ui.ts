import chalk from 'chalk';

export async function openAuthUrl(url: string): Promise<void> {
    console.log(chalk.cyan('🌐 Opening browser for MCP authentication...'));

    try {
        const { default: open } = await import('open');
        await open(url, { wait: false });
        console.log(chalk.green('✅ Browser opened'));
    } catch (_error) {
        console.log(chalk.yellow(`💡 Please open manually: ${url}`));
    }
}
