import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
    examplesSidebar: [
        {
            type: 'doc',
            id: 'intro',
            label: 'Overview',
        },
        {
            type: 'category',
            label: 'Agent Examples',
            link: {
                type: 'generated-index',
                title: 'Agent Examples',
                description: 'Practical examples showcasing Dexto agents in action.',
            },
            items: [
                'podcast-agent',
                'face-detection',
                'snake-game',
                'image-generation',
                'amazon-shopping',
                'email-slack',
                'triage-agent',
            ],
        },
        {
            type: 'category',
            label: 'More Examples',
            link: {
                type: 'generated-index',
                title: 'More Examples',
                description: 'Additional examples and platform demonstrations.',
            },
            items: [
                'portable-agents',
                'memory',
                'human-in-loop',
                'mcp-integration',
                'mcp-store',
                'playground',
            ],
        },
    ],
};

export default sidebars;
