import { mdiLanguageMarkdown } from '@mdi/js';

import { definePlugin } from '../plugin';

definePlugin({
  preview: 'markdown',
  kind: 'Markdown',
  exts: ['md', 'markdown'],
  textual: true,
  scalable: true,
  icon: mdiLanguageMarkdown,
  color: 'grey-darken-1',
  view: () => import('./View.vue'),
});
