import { mdiFileCodeOutline } from '@mdi/js';

import { definePlugin, firstMatch } from '../plugin';

/** 代码扩展名到 highlight.js 语言名的映射，未收录的按纯文本处理 */
const LANGUAGES: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', vue: 'xml',
  java: 'java', kt: 'kotlin', kts: 'kotlin', gradle: 'kotlin',
  py: 'python', rb: 'ruby', php: 'php', lua: 'lua', r: 'r', pl: 'perl',
  cs: 'csharp', go: 'go', rs: 'rust', swift: 'swift',
  c: 'c', cpp: 'cpp', h: 'cpp', hpp: 'cpp',
  css: 'css', scss: 'scss', less: 'less', sh: 'bash', bash: 'bash',
  xml: 'xml', yml: 'yaml', yaml: 'yaml',
  sql: 'sql', ini: 'ini', conf: 'ini', cfg: 'ini', toml: 'ini', properties: 'ini',
};

export const languageOf = (name: string) => {
  const index = name.lastIndexOf('.');
  return index > 0 ? (LANGUAGES[name.slice(index + 1).toLowerCase()] ?? 'plaintext') : 'plaintext';
};

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

definePlugin({
  preview: 'code',
  kind: '代码',
  exts: Object.keys(LANGUAGES),
  textual: true,
  scalable: true,
  icon: mdiFileCodeOutline,
  color: 'purple-darken-1',
  view: () => import('./View.vue'),
  sniff: firstMatch([{ bytes: ascii('<?xml'), label: 'XML 文档' }]),
});
