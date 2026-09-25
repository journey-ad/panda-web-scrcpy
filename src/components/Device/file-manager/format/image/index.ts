import { mdiImageOutline } from '@mdi/js';

import { definePlugin, firstMatch } from '../plugin';
import * as thumb from './thumbnail';

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

definePlugin({
  preview: 'image',
  kind: '图片',
  exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'heic', 'avif'],
  // 解码要完整的数据，阈值比文本类放宽
  limit: 32 * 1024 * 1024,
  media: true,
  icon: mdiImageOutline,
  color: 'deep-purple-lighten-1',
  view: () => import('./View.vue'),
  thumb,
  sniff: firstMatch([
    { bytes: ascii('WEBP'), offset: 8, label: 'WebP 图片' },
    { bytes: ascii('heic'), offset: 8, label: 'HEIF/HEIC 图片' },
    { bytes: ascii('mif1'), offset: 8, label: 'HEIF/HEIC 图片' },
    { bytes: ascii('avif'), offset: 8, label: 'AVIF 图片' },
    { bytes: [0x89, 0x50, 0x4e, 0x47], label: 'PNG 图片' },
    { bytes: [0xff, 0xd8, 0xff], label: 'JPEG 图片' },
    { bytes: ascii('GIF8'), label: 'GIF 图片' },
    { bytes: ascii('BM'), label: 'BMP 图片' },
    { bytes: [0x00, 0x00, 0x01, 0x00], label: 'ICO 图标' },
  ]),
});
