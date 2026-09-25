import { mdiTextBoxOutline } from '@mdi/js';

import { definePlugin, firstMatch } from '../plugin';

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

definePlugin({
  preview: 'text',
  kind: '文本',
  exts: ['txt', 'log', 'srt', 'vtt', 'lrc'],
  textual: true,
  scalable: true,
  icon: mdiTextBoxOutline,
  color: 'blue-lighten-1',
  view: () => import('./View.vue'),
  sniff: firstMatch([{ bytes: ascii('#!'), label: '脚本文件' }]),
});
