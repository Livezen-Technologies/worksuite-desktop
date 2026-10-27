import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import a11y from './build-tools/eslint-a11y.mjs';
import colors from './build-tools/eslint-colors.mjs';

export default tseslint.config(
  { ignores: ['vendor/**', 'out/**', 'dist/**', 'release/**', 'node_modules/**', 'build/**', 'scripts/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, a11y, colors },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Clicks the keyboard can make too, and pictures that say what they show (audit D-G21; build-tools/eslint-a11y.mjs).
      'a11y/click-has-keys': 'error',
      'a11y/img-alt': 'error',
      // Colours from the design tokens, light and dark (audit D-G23; build-tools/eslint-colors.mjs). The allow-list is
      // reviewed: each entry is a colour that must not follow the app's theme, and says why.
      'colors/no-raw-hex': [
        'error',
        {
          allow: [
            // Other companies' marks, in their own colours: Google's G and Microsoft's four squares.
            { files: ['src/app/connect/personal/PersonalWelcome.tsx'], colors: ['#4285F4', '#F25022', '#7FBA00', '#00A4EF', '#FFB900'] },
            // What a website visitor sees: the widget preview draws the organisation's own widget colours and themes.
            { files: ['src/modules/chat/website/widget/WidgetPreview.tsx'] },
            // An email as its recipients see it: the email editor and gallery draw the email's own colours.
            { files: ['src/modules/marketing/email-*.tsx'] },
            // Text the person adds onto their own picture in the image editor: its pill is the colour it is drawn in.
            { files: ['src/modules/files/image/Panels.tsx'], colors: ['#1B1F2E', '#fff'] },
            // A QR code is scanned by a phone camera: black on white whatever the theme.
            { files: ['src/modules/chat/channels/LinkPhone.tsx'], colors: ['#ffffff', '#fff', '#000000', '#000'] },
          ],
        },
      ],
      // The renderer is sandboxed: it must never reach for Node or Electron.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'The renderer talks to the desktop only through window.worksuite.' },
            { name: 'fs', message: 'No Node APIs in the renderer.' },
            { name: 'child_process', message: 'No Node APIs in the renderer.' },
          ],
          patterns: [{ group: ['node:*'], message: 'No Node APIs in the renderer.' }],
        },
      ],
      // An effect's return value is its cleanup, called when it re-runs or unmounts. Chromium's scroll
      // methods return a Promise (Chrome 152), so `useEffect(() => el.scrollIntoView())` hands React a
      // Promise to call — "destroy_ is not a function", and the screen goes. Write the body in braces.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name=/^use(Layout|Insertion)?Effect$/] > ArrowFunctionExpression > CallExpression.body[callee.property.name=/^(scrollIntoView|scrollTo|scrollBy|scroll|focus|requestFullscreen|play)$/]',
          message: 'An effect returns its cleanup: this returns what the call returns (a Promise for scrolling). Put the body in braces.',
        },
        {
          selector: 'CallExpression[callee.name=/^use(Layout|Insertion)?Effect$/] > ArrowFunctionExpression > ChainExpression.body > CallExpression[callee.property.name=/^(scrollIntoView|scrollTo|scrollBy|scroll|focus|requestFullscreen|play)$/]',
          message: 'An effect returns its cleanup: this returns what the call returns (a Promise for scrolling). Put the body in braces.',
        },
        {
          selector: 'CallExpression[callee.name=/^use(Layout|Insertion)?Effect$/] > ArrowFunctionExpression[async=true]',
          message: 'An async effect returns a Promise, which React calls as its cleanup. Start the work inside a plain effect instead.',
        },
      ],
    },
  },
  {
    files: ['tests/os/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', Buffer: 'readonly' },
    },
  },
  {
    files: ['tests/e2e/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', fetch: 'readonly', Blob: 'readonly', FormData: 'readonly', Buffer: 'readonly', WebSocket: 'readonly' },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
