import { mdiDatabase } from '@mdi/js';

import { definePlugin, firstMatch, hasBytes } from '../plugin';

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
const MAGIC = ascii('SQLite format 3');

definePlugin({
  preview: 'sqlite',
  kind: '数据库',
  exts: ['db', 'sqlite', 'sqlite3', 'db3'],
  // 整库要载入 WASM 内存，上限与图片持平
  limit: 32 * 1024 * 1024,
  icon: mdiDatabase,
  color: 'cyan-darken-1',
  view: () => import('./View.vue'),
  sniff: firstMatch([{ bytes: MAGIC, label: 'SQLite 数据库' }]),
  /** 改了后缀的库文件靠这段文件头认出来 */
  detect: (head) => hasBytes(head, MAGIC),
});
