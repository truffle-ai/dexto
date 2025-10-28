import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
    title: 'Dexto',
    tagline: 'Build AI Agents with ease',
    favicon: 'img/dexto/dexto_logo_icon.svg',

    // Set the production url of your site here
    url: 'https://docs.dexto.ai',
    // Set the /<baseUrl>/ pathname under which your site is served
    baseUrl: '/',

    // Set to false to match Vercel configuration and avoid redirect issues
    trailingSlash: false,

    // GitHub pages deployment config.
    // If you aren't using GitHub pages, you don't need these.
    organizationName: 'truffle-ai', // Usually your GitHub org/user name.
    projectName: 'dexto', // Usually your repo name.

    onBrokenLinks: 'throw',

    // Even if you don't use internationalization, you can use this field to set
    // useful metadata like html lang. For example, if your site is Chinese, you
    // may want to replace "en" with "zh-Hans".
    i18n: {
        defaultLocale: 'en',
        locales: ['en'],
    },

    presets: [
        [
            'classic',
            {
                docs: false,
                blog: {
                    showReadingTime: true,
                    feedOptions: {
                        type: ['rss', 'atom'],
                        xslt: true,
                    },
                    editUrl: 'https://github.com/truffle-ai/dexto/tree/main/docs/',
                    onInlineTags: 'warn',
                    onInlineAuthors: 'warn',
                    onUntruncatedBlogPosts: 'warn',
                    blogTitle: 'Dexto Blog',
                    blogDescription: 'The official blog for AI agents using Dexto',
                    blogSidebarCount: 'ALL',
                },
                theme: {
                    customCss: ['./src/css/brand.css', './src/css/custom.css'],
                },
            } satisfies Preset.Options,
        ],
    ],

    themes: ['@docusaurus/theme-mermaid'],

    markdown: {
        mermaid: true,
    },

    themeConfig: {
        // Replace with your project's social card
        image: 'img/dexto-social-card.jpg',
        algolia: {
            appId: 'EHM21LFJ1P',
            apiKey: 'e8246111c9f80ec60063d2b395b03ecc',
            indexName: 'Dexto docs',
            contextualSearch: true,
            searchParameters: {},
            searchPagePath: 'search',
            // askAi: 'reomyK7JUIYj',
            askAi: {
                assistantId: 'reomyK7JUIYj',
            },
        },
        docs: {
            sidebar: {
                hideable: true,
                autoCollapseCategories: false,
            },
        },
        colorMode: {
            defaultMode: 'dark',
            disableSwitch: false,
            respectPrefersColorScheme: false,
        },
        navbar: {
            logo: {
                alt: 'Dexto Logo',
                src: 'img/dexto/dexto_logo_light.svg',
                srcDark: 'img/dexto/dexto_logo.svg',
            },
            hideOnScroll: false,
            items: [
                {
                    to: '/docs/getting-started/intro',
                    position: 'left',
                    label: 'Docs',
                    activeBaseRegex: `/docs/`,
                },
                {
                    to: '/examples/intro',
                    position: 'left',
                    label: 'Examples',
                    activeBaseRegex: `/examples/`,
                },
                {
                    to: '/api',
                    position: 'left',
                    label: 'API Reference',
                    activeBaseRegex: `/api/`,
                },
                {
                    to: '/blog',
                    position: 'left',
                    label: 'Blog',
                },
                {
                    type: 'search',
                    position: 'left',
                },
                {
                    href: 'https://discord.gg/GFzWFAAZcm',
                    position: 'right',
                    className: 'header-discord-link',
                    'aria-label': 'Discord community',
                },
                {
                    href: 'https://github.com/truffle-ai/dexto',
                    position: 'right',
                    className: 'header-github-link',
                    'aria-label': 'GitHub repository',
                },
                // Mobile-only social links (Discord + GitHub in one row at bottom of sidebar)
                {
                    type: 'html',
                    position: 'right',
                    className: 'mobile-social-links',
                    value: `
                        <a href="https://discord.gg/GFzWFAAZcm" aria-label="Discord community" class="header-discord-link"></a>
                        <a href="https://github.com/truffle-ai/dexto" aria-label="GitHub repository" class="header-github-link"></a>
                    `,
                },
            ],
        },
        footer: {
            style: 'light',
            links: [
                {
                    title: 'Documentation',
                    items: [
                        {
                            label: 'Getting Started',
                            to: '/docs/getting-started/intro',
                        },
                        {
                            label: 'Guides',
                            to: '/docs/category/guides',
                        },
                        {
                            label: 'API Reference',
                            to: '/api',
                        },
                    ],
                },
                {
                    title: 'Community',
                    items: [
                        {
                            label: 'Discord',
                            href: 'https://discord.gg/GFzWFAAZcm',
                        },
                        {
                            label: 'GitHub Discussions',
                            href: 'https://github.com/truffle-ai/dexto/discussions',
                        },
                        {
                            label: 'GitHub Issues',
                            href: 'https://github.com/truffle-ai/dexto/issues',
                        },
                        {
                            label: 'X (Twitter)',
                            href: 'https://x.com/truffleai_',
                        },
                    ],
                },
                {
                    title: 'Resources',
                    items: [
                        {
                            label: 'Blog',
                            to: '/blog',
                        },
                        {
                            label: 'Examples',
                            to: '/examples/intro',
                        },
                        {
                            label: 'Contributing',
                            href: 'https://github.com/truffle-ai/dexto/blob/main/CONTRIBUTING.md',
                        },
                        {
                            label: 'Changelog',
                            href: 'https://github.com/truffle-ai/dexto/releases',
                        },
                        {
                            label: 'llms.txt',
                            href: 'https://docs.dexto.ai/llms.txt',
                        },
                    ],
                },
                {
                    title: 'Truffle AI',
                    items: [
                        {
                            label: 'Website',
                            href: 'https://trytruffle.ai',
                        },
                        {
                            label: 'GitHub',
                            href: 'https://github.com/truffle-ai',
                        },
                    ],
                },
            ],
            copyright: `Copyright © ${new Date().getFullYear()} Truffle AI. Built with ❤️ for developers.`,
        },
        prism: {
            theme: prismThemes.oneLight,
            darkTheme: prismThemes.oneDark,
            additionalLanguages: [
                'bash',
                'diff',
                'json',
                'yaml',
                'typescript',
                'javascript',
                'python',
                'go',
                'rust',
                'docker',
            ],
        },
        mermaid: {
            theme: { light: 'neutral', dark: 'dark' },
        },
        announcementBar: {
            id: 'support_us',
            content:
                '⭐️ If you like Dexto, give it a star on <a target="_blank" rel="noopener noreferrer" href="https://github.com/truffle-ai/dexto">GitHub</a> and join our <a target="_blank" rel="noopener noreferrer" href="https://discord.gg/GFzWFAAZcm">Discord</a>! ⭐️',
            backgroundColor: '#14b8a6',
            textColor: '#ffffff',
            isCloseable: true,
        },
    } satisfies Preset.ThemeConfig,

    plugins: [
        [
            '@docusaurus/plugin-content-docs',
            {
                id: 'docs',
                path: 'docs',
                routeBasePath: 'docs',
                sidebarPath: './sidebars.ts',
                editUrl: 'https://github.com/truffle-ai/dexto/tree/main/docs/',
                showLastUpdateAuthor: true,
                showLastUpdateTime: true,
                breadcrumbs: true,
            },
        ],
        [
            '@docusaurus/plugin-content-docs',
            {
                id: 'examples',
                path: 'examples',
                routeBasePath: 'examples',
                sidebarPath: './examples-sidebars.ts',
                editUrl: 'https://github.com/truffle-ai/dexto/tree/main/docs/',
                showLastUpdateAuthor: true,
                showLastUpdateTime: true,
                breadcrumbs: true,
            },
        ],
        [
            '@docusaurus/plugin-content-docs',
            {
                id: 'api',
                path: 'api',
                routeBasePath: 'api',
                sidebarPath: './api-sidebars.ts',
                editUrl: 'https://github.com/truffle-ai/dexto/tree/main/docs/',
                showLastUpdateAuthor: true,
                showLastUpdateTime: true,
                breadcrumbs: true,
            },
        ],
        './src/plugins/markdown-route-plugin.ts',
    ],

    headTags: [
        {
            tagName: 'meta',
            attributes: {
                name: 'algolia-site-verification',
                content: '5AC61F66A1FBFC7D',
            },
        },
        {
            tagName: 'link',
            attributes: {
                rel: 'preconnect',
                href: 'https://fonts.googleapis.com',
            },
        },
        {
            tagName: 'link',
            attributes: {
                rel: 'preconnect',
                href: 'https://fonts.gstatic.com',
                crossorigin: 'anonymous',
            },
        },
    ],

    stylesheets: [
        {
            href: 'https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@300;400;500;600&display=swap',
            type: 'text/css',
        },
    ],
};

export default config;
