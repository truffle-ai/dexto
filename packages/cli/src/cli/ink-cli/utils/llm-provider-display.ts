import type { LLMProvider } from '@dexto/core';

const LLM_PROVIDER_DISPLAY_NAMES: Partial<Record<LLMProvider, string>> = {
    openai: 'OpenAI',
    'openai-compatible': 'OpenAI-Compatible',
    anthropic: 'Anthropic',
    google: 'Google',
    groq: 'Groq',
    xai: 'xAI',
    cohere: 'Cohere',
    minimax: 'MiniMax',
    'minimax-cn': 'MiniMax (CN)',
    'minimax-coding-plan': 'MiniMax (Coding Plan)',
    'minimax-cn-coding-plan': 'MiniMax (CN, Coding Plan)',
    zhipuai: 'Zhipu AI (GLM)',
    'zhipuai-coding-plan': 'Zhipu AI (Coding Plan)',
    zai: 'Z.AI',
    'zai-coding-plan': 'Z.AI (Coding Plan)',
    moonshotai: 'Moonshot AI (Kimi)',
    'moonshotai-cn': 'Moonshot AI (Kimi) (CN)',
    'kimi-for-coding': 'Kimi For Coding',
    openrouter: 'OpenRouter',
    litellm: 'LiteLLM',
    glama: 'Glama',
    'google-vertex': 'Google Vertex AI (Gemini)',
    'google-vertex-anthropic': 'Google Vertex AI (Claude)',
    'amazon-bedrock': 'Amazon Bedrock',
    local: 'Local',
    ollama: 'Ollama',
    'dexto-nova': 'Dexto Nova',
};

export function getLLMProviderDisplayName(provider: LLMProvider): string {
    return LLM_PROVIDER_DISPLAY_NAMES[provider] ?? provider;
}
