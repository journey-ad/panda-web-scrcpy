import type { RangeReader } from '../../device/zip';
import { archiveFormatOf, listArchive, type ArchiveListing } from '../archive/listing';
import { previewLimit } from '../registry';
import { mimeOf } from '../../model/mime';
import { readRange } from '../../device/device-file';
import { exec } from '../../device/fs';
import type { FileEntry } from '../../model/types';
import { errorText, formatSize, formatTime, parentPath } from '../../shared/utils';

/** 文件头取样长度 */
const HEAD_BYTES = 512;

export interface InfoRow {
  key: string;
  value: string;
  /** 该行的内容可以由预览组件渲染 */
  action?: boolean;
}

/** 文件头按 16 字节一行展开成十六进制与可打印字符 */
export const hexDump = (bytes: Uint8Array): string => {
  const rows: string[] = [];
  for (let index = 0; index < bytes.length; index += 16) {
    const slice = bytes.subarray(index, index + 16);
    const hex = [...slice].map((byte) => byte.toString(16).padStart(2, '0')).join(' ').padEnd(47);
    const chars = [...slice]
      .map((byte) => (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.'))
      .join('');
    rows.push(`${index.toString(16).padStart(8, '0')}  ${hex}  ${chars}`);
  }
  return rows.join('\n');
};

/** 文件头符合纯文本特征时返回解码后的内容，含控制字符或替换符时返回空 */
export const headText = (bytes: Uint8Array): string => {
  if (!bytes.length || bytes.includes(0)) return '';
  let printable = 0;
  for (const byte of bytes) {
    if (byte === 9 || byte === 10 || byte === 13 || byte >= 32) printable += 1;
  }
  if (printable / bytes.length < 0.95) return '';
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return decoded.includes('\uFFFD') ? '' : decoded;
};

/** 属性表：条目自带的信息加上按格式与体积判出的预览说明 */
export const infoRows = (entry: FileEntry, format: string | null): InfoRow[] => {
  const rows: InfoRow[] = [
    { key: '名称', value: entry.name },
    { key: '位置', value: parentPath(entry.path) },
    { key: '类型', value: entry.kind },
    { key: '检测到的格式', value: format ?? '未识别', action: true },
    { key: 'MIME', value: mimeOf(entry.name) },
    { key: '大小', value: `${formatSize(entry.size)}（${entry.size} 字节）` },
    { key: '修改时间', value: formatTime(entry.mtime) },
  ];
  if (entry.isLink) rows.push({ key: '符号链接', value: '是' });
  const limit = entry.preview ? previewLimit(entry.preview) : null;
  if (!entry.preview) {
    rows.push({ key: '内容预览', value: '该类型没有内置预览，改为展示文件信息' });
  } else if (limit && entry.size > limit) {
    rows.push({ key: '内容预览', value: `文件超过 ${formatSize(limit)}，未加载内容` });
  }
  return rows;
};

export interface HeadResult {
  bytes: Uint8Array;
  note: string;
  reader: RangeReader | null;
}

/** 读取文件头并留下继续按段读取的通道 */
export const readHead = async (entry: FileEntry): Promise<HeadResult> => {
  const length = Math.max(1, Math.min(HEAD_BYTES, entry.size));
  try {
    const bytes = await readRange(entry.path, 0, length);
    return { bytes, note: '', reader: (start, end) => readRange(entry.path, start, end) };
  } catch (error) {
    return { bytes: new Uint8Array(), note: `读取文件失败：${errorText(error)}`, reader: null };
  }
};

/** ls -ld 的原始输出，权限或设备不支持时为空 */
export const readListing = async (entry: FileEntry): Promise<string> => {
  try {
    return (await exec(['ls', '-ld', entry.path])).trim();
  } catch {
    return '';
  }
};

/** 可识别的压缩包列出内部条目，失败时返回只带说明的清单 */
export const readArchive = async (
  entry: FileEntry,
  reader: RangeReader | null,
  bytes: Uint8Array
): Promise<ArchiveListing | null> => {
  if (!reader) return null;
  const format = archiveFormatOf(bytes);
  if (!format) return null;
  try {
    return await listArchive(format, entry.size, reader, bytes);
  } catch (error) {
    return {
      format: '归档',
      tree: [],
      count: 0,
      total: 0,
      truncated: false,
      note: `读取条目失败：${errorText(error)}`,
    };
  }
};
