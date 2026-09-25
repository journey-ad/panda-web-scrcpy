import { mdiBookOpenVariant } from '@mdi/js';

import { definePlugins } from '../plugin';

/** epub 与 mobi 共用同一个预览组件 */
definePlugins([
  {
    preview: 'epub',
    kind: '电子书',
    exts: ['epub'],
    icon: mdiBookOpenVariant,
    color: 'blue-grey-darken-1',
    view: () => import('./View.vue'),
  },
  {
    preview: 'mobi',
    kind: '电子书',
    exts: ['mobi'],
    icon: mdiBookOpenVariant,
    color: 'blue-grey-darken-1',
    view: () => import('./View.vue'),
  },
]);
