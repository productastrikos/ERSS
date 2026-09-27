import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `src/_legacy` is grafted-in DSO code, kept for the reference data the map layers
  // import out of it (shared/map/live/roadWatch.ts and the agency layers). It was never
  // written against these rules and its panels are not rendered by either surface, so
  // linting it only ever produced 68 findings nobody was going to action. The shipped
  // ERSS sources — console, app, lib, shared — are linted clean.
  globalIgnores(['dist', 'src/_legacy']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
