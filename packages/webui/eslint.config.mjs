import tsParser from '@typescript-eslint/parser';

// TODO: Improve imports to make them browser-safe.
// Local ESLint config for the Web UI only.
// Keeps the UI browser-safe by routing all shared types through '@dexto/client-sdk'.
// Importing '@dexto/core' directly can pull Node-only modules (fs/path/winston)
// into the bundle — use the API for runtime behavior instead.
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
      // Forbid imports that can pull Node-only code
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@dexto/core/logger',
              message:
                'Web UI must not import the Node logger. Use the API for runtime or rely on browser console logging.',
            },
            {
              name: '@dexto/core',
              message:
                'Web UI must source shared types from @dexto/client-sdk to keep browser bundles lean.',
            },
          ],
        },
      ],
    },
  },
  // Ignore build artifacts in this package
  {
    ignores: ['.next/**', 'out/**', 'node_modules/**']
  }
];
