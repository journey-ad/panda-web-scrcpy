import { mdiCodeJson } from '@mdi/js';

import { definePlugin } from '../plugin';

definePlugin({
  preview: 'json',
  kind: 'JSON',
  exts: ['json', 'json5'],
  textual: true,
  scalable: true,
  icon: mdiCodeJson,
  color: 'grey-darken-1',
  // 与纯文本共用渲染组件，只是高亮规则不同
  view: () => import('../text/View.vue'),
});
