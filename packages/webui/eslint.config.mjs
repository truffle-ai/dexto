import tsParser from '@typescript-eslint/parser';

// TODO: Improve imports to make them browser-safe.
// Local ESLint config for the Web UI only.
// Keeps the UI browser-safe by restricting imports to types (and `toError`) from '@dexto/core'.
// If a rule fails, it means an import would pull Node-only modules (fs/path/winston)
// into the UI bundle — use the API for runtime instead.
export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        WebSocket: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': await import('@typescript-eslint/eslint-plugin').then(m => m.default || m),
      'react-hooks': await import('eslint-plugin-react-hooks').then(m => m.default || m),
    },
    rules: {
      // Block specific problematic imports only
      // The browser bundle (index.browser.ts) and conditional exports already
      // ensure only browser-safe exports are available. This rule just catches
      // accidental deep imports that bypass the bundle.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@dexto/core/logger',
              message:
                'Web UI must not import the Node logger. Use the API for runtime or rely on browser console logging.',
            },
          ],
          patterns: [
            {
              group: ['@dexto/core/*'],
              message:
                'Do not use deep imports from @dexto/core. Import from @dexto/core directly - the browser bundle ensures only safe exports are available.',
            },
          ],
        },
      ],
      // React Hooks rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // Ignore build artifacts in this package
  {
    ignores: ['.next/**', 'out/**', 'node_modules/**']
  }
];
