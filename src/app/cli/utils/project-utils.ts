// src/app/cli/utils/project-utils.ts

import fs from 'node:fs/promises';
import { parseDocument } from 'yaml';
import { LLMProvider, getDefaultModelForProvider } from '@core/index.js';
import { getPrimaryApiKeyEnvVar } from '@core/utils/api-key-resolver.js';

/**
 * Updates the LLM provider information in a dexto config file
 * Used for project creation/initialization (modifies agent.yml files)
 * @param filepath Path to agent config file
 * @param llmProvider LLM provider to configure
 */
export async function updateDextoConfigFile(
    filepath: string,
    llmProvider: LLMProvider
): Promise<void> {
    const fileContent = await fs.readFile(filepath, 'utf8');
    const doc = parseDocument(fileContent);
    doc.setIn(['llm', 'provider'], llmProvider);
    doc.setIn(['llm', 'apiKey'], '$' + getPrimaryApiKeyEnvVar(llmProvider));
    doc.setIn(['llm', 'model'], getDefaultModelForProvider(llmProvider));
    await fs.writeFile(filepath, doc.toString(), 'utf8');
}
