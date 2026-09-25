import { mdiFormatFont } from '@mdi/js';

import { definePlugin, firstMatch } from '../plugin';

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

definePlugin({
  preview: 'font',
  kind: '字体',
  exts: ['ttf', 'otf', 'woff', 'woff2'],
  icon: mdiFormatFont,
  color: 'brown-darken-1',
  view: () => import('./View.vue'),
  sniff: firstMatch([
    { bytes: [0x00, 0x01, 0x00, 0x00], label: 'TrueType 字体' },
    { bytes: ascii('OTTO'), label: 'OpenType 字体' },
  ]),
});
