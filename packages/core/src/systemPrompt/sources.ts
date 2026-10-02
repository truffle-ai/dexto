/**
 * Dynamic prompt generator source identifiers.
 *
 * Kept in a dependency-free module so config schemas (and the `@dexto/core/config` facade)
 * can reference the allowed sources without importing the generator registry, which pulls in
 * Node-only handlers.
 */
export const PROMPT_GENERATOR_SOURCES = ['date', 'env', 'resources'] as const;

export type PromptGeneratorSource = (typeof PROMPT_GENERATOR_SOURCES)[number];
