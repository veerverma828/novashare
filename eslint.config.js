import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'android', 'ios']),
  {
    files: ['**/*.{js,jsx}'],
    ignores: ['vite.config.js'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Preview rule aimed at React Compiler adoption; flags legitimate
      // "sync state to external trigger" effects (routing, platform checks)
      // that already guard against re-render loops via their deps array.
      'react-hooks/set-state-in-effect': 'off',
      // Same family of React Compiler preview rules, same problem: these
      // treat any ref/Date.now()/etc. reachable from the component body as
      // "used during render" even when it's only ever read inside an event
      // handler or an async callback (e.g. sendClip's Date.now(), the
      // pre-send "Add more" menu's ref-triggering onClick handlers) — App.jsx
      // predates the compiler's stricter authoring rules and isn't a target
      // for it yet, so these three just produce noise here.
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
    },
  },
  {
    files: ['vite.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
])
