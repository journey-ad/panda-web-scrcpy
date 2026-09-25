import { mdiMovieOutline } from '@mdi/js';

import { definePlugin, firstMatch } from '../plugin';
import * as thumb from './thumbnail';

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

definePlugin({
  preview: 'video',
  kind: '视频',
  // 不含 ts：MPEG-TS 与 TypeScript 扩展名相同
  exts: ['mp4', 'webm', 'mkv', 'mov', '3gp', 'm4v', 'avi'],
  // 走 Service Worker 代理按需读取，不整体载入
  limit: null,
  media: true,
  icon: mdiMovieOutline,
  color: 'deep-purple-lighten-1',
  view: () => import('./View.vue'),
  thumb,
  sniff: firstMatch([
    { bytes: ascii('AVI '), offset: 8, label: 'AVI 视频' },
    { bytes: ascii('qt  '), offset: 8, label: 'QuickTime 视频' },
    { bytes: ascii('3gp4'), offset: 8, label: '3GPP 视频' },
    { bytes: ascii('ftyp'), offset: 4, label: 'MP4 视频' },
    { bytes: [0x1a, 0x45, 0xdf, 0xa3], label: 'Matroska/WebM 视频' },
  ]),
});
