import { mdiLanguageHtml5 } from '@mdi/js';

import { definePlugin, firstMatch } from '../plugin';

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

definePlugin({
  preview: 'html',
  kind: 'HTML',
  exts: ['html', 'htm'],
  // 字号由文档自身排版决定，因此不参与缩放
  textual: true,
  icon: mdiLanguageHtml5,
  color: 'grey-darken-1',
  view: () => import('./View.vue'),
  sniff: firstMatch([
    { bytes: ascii('<!DOCTYPE'), label: 'HTML 文档' },
    { bytes: ascii('<!doctype'), label: 'HTML 文档' },
    { bytes: ascii('<html'), label: 'HTML 文档' },
  ]),
});
