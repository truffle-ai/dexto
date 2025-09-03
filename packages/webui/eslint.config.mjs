import tsParser from '@typescript-eslint/parser';

// Local ESLint config for the Web UI only.
// Keeps the UI browser-safe by restricting imports to types (and `toError`) from '@dexto/core'
// and forbidding internal '@core/*' imports. If a rule fails, it means an import would
// pull Node-only modules (fs/path/winston) into the UI bundle — use the API for runtime instead.

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
    },
    rules: {
      // Forbid internal alias imports that can pull Node-only code
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@core/*'],
              message:
                "Web UI must not import from '@core/*'. Use '@dexto/core' for types, and call the API for runtime. This avoids bundling Node-only modules (fs/path/winston).",
            },
          ],
          paths: [
            {
              name: '@dexto/core/logger',
              message:
                'Web UI must not import the Node logger. Use the API for runtime or rely on browser console logging.',
            },
          ],
        },
      ],
      // Disallow value imports from '@dexto/core' except `toError`.
      // Keep browser bundles safe while long-term logger split is pending.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "ImportDeclaration[source.value='@dexto/core'][importKind!='type'] > ImportDefaultSpecifier",
          message:
            "Web UI can only import types or `toError` from '@dexto/core'. Use the API for runtime behavior.",
        },
        {
          selector:
            "ImportDeclaration[source.value='@dexto/core'][importKind!='type'] > ImportNamespaceSpecifier",
          message:
            "Web UI can only import types or `toError` from '@dexto/core'. Use the API for runtime behavior.",
        },
        {
          selector:
            "ImportDeclaration[source.value='@dexto/core'][importKind!='type'] > ImportSpecifier:not([imported.name='toError'])",
          message:
            "Web UI can only import types or `toError` from '@dexto/core'. Use the API for runtime behavior.",
        },
      ],
    },
  },
  // Ignore build artifacts in this package
  {
    ignores: ['.next/**', 'out/**', 'node_modules/**']
  }
];
