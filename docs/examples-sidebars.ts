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
            label: 'Examples',
            link: {
                type: 'generated-index',
                title: 'Examples',
                description: 'Practical examples showcasing Dexto in action.',
            },
            items: [
                'email-slack',
                'mcp-integration',
                'snake-game',
                'image-generation',
                'face-detection',
                'podcast-agent',
                'amazon-shopping',
            ],
        },
    ],
};

export default sidebars;
