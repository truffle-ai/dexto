import * as handlers from './in-built-prompts.js';
import { DynamicContributorContext } from './types.js';

/**
 * This file contains the registry of all the functions that can generate dynamic prompt pieces at runtime.
 */
export type DynamicPromptGenerator = (context: DynamicContributorContext) => Promise<string>;

// Available dynamic prompt generator sources
export const PROMPT_GENERATOR_SOURCES = ['date', 'env', 'resources'] as const;

export type PromptGeneratorSource = (typeof PROMPT_GENERATOR_SOURCES)[number];

// Registry mapping sources to their generator functions
export const PROMPT_GENERATOR_REGISTRY: Record<PromptGeneratorSource, DynamicPromptGenerator> = {
    date: handlers.getCurrentDate,
    env: handlers.getEnvironmentInfo,
    resources: handlers.getResourceData,
};

// To fetch a prompt generator function from its source
export function getPromptGenerator(
    source: PromptGeneratorSource
): DynamicPromptGenerator | undefined {
    return PROMPT_GENERATOR_REGISTRY[source];
}
