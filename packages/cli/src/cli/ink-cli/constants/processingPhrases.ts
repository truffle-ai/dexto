/**
 * Processing phrases for the status bar
 * These cycle during processing to provide entertaining feedback
 */

import { no } from 'zod/v4/locales';

export const processingPhrases: string[] = [
    // pop culture
    'I want to be the very best...',
    'I will be the next hokage...',
    'Shinzo Sasageyo...',
    'My soldiers! Rage! ...',
    'May the force be with you...',
    'Why so serious? ...',
    "That's what she said ...",
    'Winter is coming...',

    // Playful
    'Let me cook...',
    'Manifesting greatness..',
    'Rizzing the huzz...',
    'Memeing...',
    'Outperforming other AI agents...',
    'Rolling with the squad...',
    'Incanting secret scripts...',
    'Making no mistakes...',
    'Making you rich...',
    'Farming easy points...',
    'Using 200+ IQ...',
    'Turning into Jarvis...',
    'Dextomaxxing...',
    'Zapping...',
    'Braining...',
    'Using all 3 brain cells...',
    'Installing malware (just kidding)...',

    // Nerdy
    'Attention is all I need...',
    'Transformer powers activate...',
];

/**
 * Get a random phrase from the list
 */
export function getRandomPhrase(): string {
    const index = Math.floor(Math.random() * processingPhrases.length);
    return processingPhrases[index] ?? 'Processing...';
}
