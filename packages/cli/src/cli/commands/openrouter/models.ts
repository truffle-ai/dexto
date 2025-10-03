// packages/cli/src/cli/commands/openrouter/models.ts

import chalk from 'chalk';
import * as p from '@clack/prompts';
import {
    refreshOpenRouterModelCache,
    getCachedOpenRouterModels,
    getOpenRouterModelCacheInfo,
} from '@dexto/core';
import { getOpenRouterApiKey, isAuthenticated } from '../../utils/auth-service.js';

export async function handleOpenRouterModelsCommand(): Promise<void> {
    try {
        p.intro(chalk.inverse(' OpenRouter Models '));

        if (!(await isAuthenticated())) {
            console.log(chalk.red('❌ Not authenticated. Please run `dexto login` first.'));
            return;
        }

        const openRouterKey = await getOpenRouterApiKey();
        if (!openRouterKey) {
            console.log(chalk.yellow('⚠️  No OpenRouter API key found.'));
            console.log(
                chalk.dim('   Run `dexto login` to automatically provision an OpenRouter API key.')
            );
            return;
        }

        console.log(chalk.green('✅ OpenRouter API key found'));
        console.log(chalk.dim('Fetching latest model catalog from OpenRouter...'));

        try {
            await refreshOpenRouterModelCache({ force: true, apiKey: openRouterKey });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.log(
                chalk.yellow(
                    `⚠️  Could not refresh model list from OpenRouter (${message}). Showing cached results if available.`
                )
            );
        }

        const models = getCachedOpenRouterModels();
        const cacheInfo = getOpenRouterModelCacheInfo();

        if (!models || models.length === 0) {
            console.log(
                chalk.red(
                    '❌ No OpenRouter models available in cache. Ensure you are online and try again.'
                )
            );
            return;
        }

        const freshnessLabel = cacheInfo.lastFetchedAt
            ? `${cacheInfo.isFresh ? 'updated' : 'cached'} ${formatRelativeTime(cacheInfo.lastFetchedAt)} (${cacheInfo.lastFetchedAt.toISOString()})`
            : 'timestamp unavailable';

        console.log(chalk.dim(`\nFound ${models.length} models (${freshnessLabel}).`));

        const providers = aggregateProviders(models);
        if (providers.length > 0) {
            console.log(chalk.dim('\nTop providers by model count:'));
            providers.slice(0, 10).forEach(([provider, count]) => {
                console.log(chalk.dim(`   ${provider}: ${count}`));
            });
        }

        const DISPLAY_LIMIT = 20;
        console.log(
            chalk.dim(`\nSample models (${Math.min(DISPLAY_LIMIT, models.length)} shown):`)
        );
        models.slice(0, DISPLAY_LIMIT).forEach((model, index) => {
            console.log(chalk.cyan(`   ${index + 1}. ${model}`));
        });

        if (models.length > DISPLAY_LIMIT) {
            console.log(
                chalk.dim(
                    `\n… ${models.length - DISPLAY_LIMIT} more models available. Use shell tools such as \`dexto openrouter-models | grep <term>\` to filter by keyword.`
                )
            );
        }

        console.log(chalk.dim('\nTo use these models, configure your agent with:'));
        console.log(chalk.cyan('   provider: openai-compatible'));
        console.log(chalk.cyan('   router: vercel'));
        console.log(chalk.cyan('   baseURL: https://openrouter.ai/api/v1'));
        console.log(chalk.cyan('   model: <model-name>'));

        p.outro(chalk.green('OpenRouter models are ready to use!'));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        p.outro(chalk.red(`❌ Failed to show OpenRouter models: ${errorMessage}`));
        process.exit(1);
    }
}

function aggregateProviders(models: string[]): Array<[string, number]> {
    const counts = new Map<string, number>();
    for (const model of models) {
        const [rawProvider] = model.split('/');
        const provider = rawProvider && rawProvider.length > 0 ? rawProvider : 'unknown';
        counts.set(provider, (counts.get(provider) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function formatRelativeTime(timestamp: Date): string {
    const diffMs = Date.now() - timestamp.getTime();
    if (diffMs <= 0) {
        return 'just now';
    }

    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;

    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;

    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;

    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? '' : 's'} ago`;
}
