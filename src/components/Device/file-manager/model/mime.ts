/**
 * 文件名层面的 MIME 判定
 * 设备层要按类型给出流式地址，这条知识不能带上任何预览类型的概念，因此留在模型层
 */

const MIME_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', avif: 'image/avif', heic: 'image/heic',
  mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mov: 'video/quicktime', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/mp4', m4a: 'audio/mp4',
  m4v: 'video/mp4', opus: 'audio/ogg', amr: 'audio/amr',
  pdf: 'application/pdf', md: 'text/markdown', html: 'text/html', json: 'application/json', csv: 'text/csv', tsv: 'text/tab-separated-values',
  // HTML 预览里的相对资源，脚本与样式的类型不正确会被浏览器拒绝
  css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
  txt: 'text/plain', xml: 'text/xml', wasm: 'application/wasm',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  db: 'application/vnd.sqlite3', sqlite: 'application/vnd.sqlite3',
  sqlite3: 'application/vnd.sqlite3', db3: 'application/vnd.sqlite3',
};

/** Chrome 不支持 quicktime 与 3gpp 两个类型，MP4 系列统一按 video/mp4 交给播放器 */
const MP4_FAMILY = ['mp4', 'm4v', 'mov', '3gp'];

export const extensionOf = (name: string) => {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index + 1).toLowerCase() : '';
};

/** MP4 系列容器结构相同，流类型与内嵌封面按同一逻辑处理 */
export const isMp4Family = (name: string) => MP4_FAMILY.includes(extensionOf(name));

export const mimeOf = (name: string) => MIME_TYPES[extensionOf(name)] ?? 'application/octet-stream';

/** 流式地址的类型：MP4 系列统一成浏览器能播的那个 */
export const streamTypeOf = (name: string) => (isMp4Family(name) ? 'video/mp4' : mimeOf(name));
