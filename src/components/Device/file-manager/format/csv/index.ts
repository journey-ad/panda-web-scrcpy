import { mdiFileDelimitedOutline } from '@mdi/js';

import { definePlugin } from '../plugin';

definePlugin({
  preview: 'csv',
  kind: '表格',
  exts: ['csv', 'tsv'],
  textual: true,
  scalable: true,
  icon: mdiFileDelimitedOutline,
  color: 'teal-darken-1',
  view: () => import('./View.vue'),
});
