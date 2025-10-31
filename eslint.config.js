import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import requireZodDescribe from './eslint-rules/require-zod-describe.js';

export default [
    // Base config for all files
    js.configs.recommended,
    {
        linterOptions: {
            reportUnusedDisableDirectives: 'warn',
        }
    },

    // TypeScript specific config (general rules)
    {
        files: ['**/*.ts'],
        languageOptions: {
            parser: tsParser,
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                console: 'readonly',
                process: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                global: 'readonly',
                require: 'readonly',
                __dirname: 'readonly',
                module: 'readonly',
                document: 'readonly',
                window: 'readonly',
                HTMLElement: 'readonly',
                HTMLAnchorElement: 'readonly',
                HTMLImageElement: 'readonly',
                Element: 'readonly',
                Node: 'readonly',
                clearInterval: 'readonly',
                setInterval: 'readonly',
                Buffer: 'readonly',
                URL: 'readonly',
                AbortController: 'readonly',
                AbortSignal: 'readonly',
                structuredClone: 'readonly',
                NodeJS: 'readonly',
                CustomEvent: 'readonly',
                localStorage: 'readonly',
                FileReader: 'readonly',
                WebSocket: 'readonly',
                fetch: 'readonly',
                URLSearchParams: 'readonly',
                RequestInfo: 'readonly',
                Response: 'readonly',
                RequestInit: 'readonly',
                // Browser Speech Synthesis API globals used in webui
                SpeechSynthesisUtterance: 'readonly',
                SpeechSynthesisVoice: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
        },
        rules: {
            'no-console': 'off',
            'no-unused-vars': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
            'no-dupe-class-members': 'off', // Allow TypeScript method overloading
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'TSTypeReference > TSTypeQuery > Identifier[name="z"] ~ TSQualifiedName > Identifier[name="infer"]',
                    message: 'Use z.output instead of z.infer for better type inference with Zod schemas. z.output includes transformations while z.infer may miss them.',
                },
                {
                    selector: 'TSTypeReference[typeName.type="TSQualifiedName"][typeName.left.name="z"][typeName.right.name="infer"]',
                    message: 'Use z.output instead of z.infer for better type inference with Zod schemas. z.output includes transformations while z.infer may miss them.',
                },
            ],
        },
    },

    // Zod .describe() enforcement for API route files only
    {
        files: ['**/server/src/**/*.ts', '**/api/routes/**/*.ts'],
        plugins: {
            'dexto-custom': {
                rules: {
                    'require-zod-describe': requireZodDescribe,
                },
            },
        },
        rules: {
            // Enforce .describe() on Zod schemas for OpenAPI documentation
            // Only applies to API route files where OpenAPI docs are generated
            'dexto-custom/require-zod-describe': [
                'error',
                {
                    exemptSchemaNames: [
                        // Add schema names here that should be exempt from requiring .describe()
                        // Example: 'TestMockSchema', 'InternalConfigSchema'
                    ],
                },
            ],
        },
    },

    // Ignore patterns (keep existing ignores)
    {
        ignores: [
            'node_modules/**',
            '**/dist/**',
            '.cursor/**',
            'public/**',
            // Use the package-local ESLint config for Web UI instead of root config
            'packages/webui/**',
            '**/build/**',
            '**/coverage/**',
            'test-temp/**',
            '**/*.min.js',
            '**/generated/**',
            'docs/.docusaurus/**',
            'scripts/dev.js',
            'scripts/dev-status.js',
            'scripts/test_websocket.js',
            'packages/cli/src/web/client/script.js',
            'packages/webui/tailwind.config.js',
            '**/.venv/**',
            '**/venv/**',
            '**/env/**',
            '**/__pycache__/**',
            '**/*.pyc',
            '**/*.pyo',
            '**/*.pyd'
        ],
    },

    prettier,
];
