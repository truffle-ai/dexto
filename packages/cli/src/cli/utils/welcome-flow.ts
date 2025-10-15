// packages/cli/src/cli/utils/welcome-flow.ts

import * as p from '@clack/prompts';
import chalk from 'chalk';

export type WelcomeChoice = 'login' | 'manual' | 'exit';

/**
 * Shows the main welcome screen with two clear options for getting started
 */
export async function handleWelcomeFlow(): Promise<WelcomeChoice> {
    p.intro(chalk.cyan('🚀 Welcome to Dexto'));

    p.note(
        'Dexto is an AI agent platform that helps you build and deploy intelligent assistants.\n\n' +
            "Choose how you'd like to get started:",
        'Getting Started'
    );

    const choice = await p.select({
        message: 'How would you like to get started?',
        options: [
            {
                value: 'login',
                label: '🚀 Login with Dexto (Recommended)',
                hint: 'Get instant access to 100+ models with automatic setup',
            },
            {
                value: 'manual',
                label: '🔧 Configure Manually',
                hint: 'Use your own API keys for full control',
            },
            {
                value: 'exit',
                label: 'Exit',
                hint: 'Quit for now',
            },
        ],
    });

    if (p.isCancel(choice)) {
        p.cancel('Setup cancelled');
        process.exit(0);
    }

    return choice as WelcomeChoice;
}

/**
 * Shows detailed information about the login option
 */
export async function showLoginDetails(): Promise<boolean> {
    p.note(
        '🚀 Login with Dexto provides:\n\n' +
            '• Automatic AI model access provisioning\n' +
            '• Access to 100+ AI models (GPT-4, Claude, Gemini, etc.)\n' +
            '• Free tier included with $10 credit\n' +
            '• No manual API key setup required\n' +
            '• Secure authentication via Google/GitHub\n\n' +
            'This is the fastest way to get started with Dexto!',
        'Login Benefits'
    );

    const shouldContinue = await p.confirm({
        message: 'Continue with login?',
        initialValue: true,
    });

    if (p.isCancel(shouldContinue)) {
        p.cancel('Login cancelled');
        return false;
    }

    return shouldContinue;
}

/**
 * Shows detailed information about manual configuration
 */
export async function showManualDetails(): Promise<boolean> {
    p.note(
        '🔧 Manual Configuration provides:\n\n' +
            '• Full control over your API keys\n' +
            '• Support for OpenAI, Anthropic, Google, Groq, etc.\n' +
            '• Advanced configuration options\n' +
            '• No external dependencies\n' +
            '• Complete privacy and control\n\n' +
            "You'll need to obtain API keys from your chosen providers.",
        'Manual Configuration'
    );

    const shouldContinue = await p.confirm({
        message: 'Continue with manual setup?',
        initialValue: true,
    });

    if (p.isCancel(shouldContinue)) {
        p.cancel('Manual setup cancelled');
        return false;
    }

    return shouldContinue;
}
