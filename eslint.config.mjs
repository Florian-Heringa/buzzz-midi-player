import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { Buffer: 'readonly', console: 'readonly', process: 'readonly', fetch: 'readonly' }
    }
  },
  {
    // Functions in the smoke test run inside the app page.
    files: ['scripts/drive.mjs'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        AudioNode: 'readonly',
        AudioDestinationNode: 'readonly',
        HTMLInputElement: 'readonly',
        Event: 'readonly',
        AudioContext: 'readonly',
        localStorage: 'readonly',
        atob: 'readonly',
        getComputedStyle: 'readonly'
      }
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules
  }
)
