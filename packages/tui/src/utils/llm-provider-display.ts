import { parseCodexBaseURL, type LLMProvider } from '@dexto/core';

const LLM_PROVIDER_DISPLAY_NAMES: Record<LLMProvider, string> = {
    openai: 'OpenAI',
    'openai-compatible': 'OpenAI-Compatible',
    anthropic: 'Anthropic',
    google: 'Google',
    groq: 'Groq',
    xai: 'xAI',
    cohere: 'Cohere',
    minimax: 'MiniMax',
    glm: 'GLM',
    openrouter: 'OpenRouter',
    litellm: 'LiteLLM',
    glama: 'Glama',
    vertex: 'Vertex',
    bedrock: 'Bedrock',
    local: 'Local',
    ollama: 'Ollama',
    'dexto-nova': 'Dexto Nova',
};

export function getLLMProviderDisplayName(provider: LLMProvider, baseURL?: string): string {
    if (provider === 'openai-compatible') {
        const codex = parseCodexBaseURL(baseURL);
        if (codex?.authMode === 'chatgpt') {
            return 'via ChatGPT';
        }
        if (codex) {
            return 'via Codex';
        }
    }

    return LLM_PROVIDER_DISPLAY_NAMES[provider] ?? provider;
}
