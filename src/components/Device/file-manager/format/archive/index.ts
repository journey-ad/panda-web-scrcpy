import { mdiZipBoxOutline } from '@mdi/js';

import { definePlugin, firstMatch, type MagicRule } from '../plugin';

/** ZIP 家族按同一个结尾目录结构识别，分卷与空包的签名不同 */
const ZIP_MAGIC: MagicRule[] = [
  { bytes: [0x50, 0x4b, 0x03, 0x04], label: 'ZIP 归档' },
  { bytes: [0x50, 0x4b, 0x05, 0x06], label: 'ZIP 归档（空）' },
  { bytes: [0x50, 0x4b, 0x07, 0x08], label: 'ZIP 归档（分卷）' },
];

/** 压缩包没有内置预览，只登记类型名与图标，列表与解压入口按它识别 */
definePlugin({
  kind: '压缩包',
  group: 'archive',
  exts: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'],
  icon: mdiZipBoxOutline,
  sniff: firstMatch([
    ...ZIP_MAGIC,
    { bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], label: 'RAR 压缩包' },
    { bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], label: '7Z 压缩包' },
    { bytes: [0x1f, 0x8b], label: 'GZIP 压缩' },
    { bytes: [0x42, 0x5a, 0x68], label: 'BZIP2 压缩' },
    { bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a], label: 'XZ 压缩' },
    { bytes: [0x28, 0xb5, 0x2f, 0xfd], label: 'Zstandard 压缩' },
    { bytes: [0x04, 0x22, 0x4d, 0x18], label: 'LZ4 压缩' },
  ]),
});
