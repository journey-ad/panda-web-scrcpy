/**
 * 压缩包内容列表：只按需读文件末尾或开头一段，不解压内容
 * ZIP 直接复用 APK 侧的中央目录解析，tar / GZIP 按各自的头部结构扫描
 */

import { decodeName, readZipEntries, type RangeReader } from '../../device/zip';

export type ArchiveFormat = 'zip' | 'tar' | 'gzip' | 'rar' | '7z' | 'bzip2' | 'xz';

export interface ArchiveEntry {
  name: string;
  /** 解压后大小 */
  size: number;
  /** 压缩后大小 */
  packed: number;
  method: string;
  isDirectory: boolean;
}

/** 树上的一个节点，目录由路径推导出来 */
export interface ArchiveNode {
  /** 本级名称 */
  name: string;
  /** 归档内的完整路径 */
  path: string;
  size: number;
  method: string;
  isDirectory: boolean;
  children: ArchiveNode[];
}

export interface ArchiveListing {
  format: string;
  tree: ArchiveNode[];
  /** 列出的文件数，不含目录 */
  count: number;
  /** 归档内文件总数，超出上限时大于 count */
  total: number;
  truncated: boolean;
  /** 无法列出条目时的说明 */
  note: string;
}

/** 列表里最多展示的文件数，其余只计数不渲染 */
const MAX_LISTED = 32;
/** tar 是顺序结构，只扫描开头这一段 */
const TAR_WINDOW = 512 * 1024;

const ZIP_METHODS: Record<number, string> = {
  0: '存储',
  8: 'Deflate',
  9: 'Deflate64',
  12: 'BZip2',
  14: 'LZMA',
  20: 'Zstd',
  93: 'Zstd',
  95: 'XZ',
  98: 'PPMd',
  99: 'AES',
};

const FORMAT_LABELS: Record<ArchiveFormat, string> = {
  zip: 'ZIP',
  tar: 'TAR',
  gzip: 'GZIP',
  rar: 'RAR',
  '7z': '7Z',
  bzip2: 'BZIP2',
  xz: 'XZ',
};

const textDecoder = new TextDecoder();
const latin1 = new TextDecoder('latin1');

const beginsWith = (head: Uint8Array, bytes: number[], offset = 0) =>
  head.length >= offset + bytes.length && bytes.every((byte, index) => head[offset + index] === byte);

/** 按文件头判断压缩格式，tar 没有固定的魔数，以 ustar 标识判断 */
export const archiveFormatOf = (head: Uint8Array): ArchiveFormat | null => {
  if (beginsWith(head, [0x50, 0x4b, 0x03, 0x04]) || beginsWith(head, [0x50, 0x4b, 0x05, 0x06])) return 'zip';
  if (beginsWith(head, [0x1f, 0x8b])) return 'gzip';
  if (beginsWith(head, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return 'rar';
  if (beginsWith(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return '7z';
  if (beginsWith(head, [0x42, 0x5a, 0x68])) return 'bzip2';
  if (beginsWith(head, [0xfd, 0x37, 0x7a, 0x58, 0x5a])) return 'xz';
  const magic = latin1.decode(head.subarray(257, 262));
  if (magic === 'ustar') return 'tar';
  return null;
};

const listZip = async (size: number, read: RangeReader) => {
  const { entries } = await readZipEntries(size, read);
  const kept: ArchiveEntry[] = [];
  let total = 0;
  for (const entry of entries) {
    const isDirectory = entry.name.endsWith('/');
    if (!isDirectory) total += 1;
    // 达到上限后停止收录，但仍要统计完文件，末行才能报出剩余数量
    if (total > MAX_LISTED) continue;
    kept.push({
      name: entry.name,
      size: entry.size,
      packed: entry.compressedSize,
      method: ZIP_METHODS[entry.method] ?? `方式 ${entry.method}`,
      isDirectory,
    });
  }
  return { entries: kept, total };
};

/** tar 头部全为 0 即归档结束 */
const tarEnds = (header: Uint8Array) => {
  for (const byte of header) {
    if (byte !== 0) return false;
  }
  return true;
};

/** 取 tar 头里的定长字段，去掉末尾的填充 */
const tarField = (header: Uint8Array, from: number, length: number) => {
  const slice = header.subarray(from, from + length);
  const end = slice.indexOf(0);
  return end < 0 ? slice : slice.subarray(0, end);
};

const listTar = async (size: number, read: RangeReader) => {
  const window = await read(0, Math.min(size, TAR_WINDOW));
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  let longName = '';
  let total = 0;
  let finished = false;

  while (offset + 512 <= window.length) {
    const header = window.subarray(offset, offset + 512);
    if (tarEnds(header)) {
      finished = true;
      break;
    }
    const sizeText = textDecoder.decode(tarField(header, 124, 12)).trim();
    const entrySize = sizeText ? Number.parseInt(sizeText, 8) || 0 : 0;
    const blocks = Math.ceil(entrySize / 512);
    const type = String.fromCharCode(header[156] || 0x30);

    // 长文件名与 pax 扩展头本身不是条目，数据块里放的是下一个条目的元信息
    if (type === 'L' || type === 'x') {
      if (type === 'L') {
        longName = decodeName(tarField(window.subarray(offset + 512, offset + 512 + entrySize), 0, entrySize), false);
      }
      offset += 512 + blocks * 512;
      continue;
    }

    const prefix = decodeName(tarField(header, 345, 155), false);
    const name = longName || [prefix, decodeName(tarField(header, 0, 100), false)].filter(Boolean).join('/');
    longName = '';
    const isDirectory = type === '5' || name.endsWith('/');
    if (!isDirectory) total += 1;
    if (total > MAX_LISTED) {
      offset += 512 + blocks * 512;
      continue;
    }
    entries.push({
      name,
      size: entrySize,
      packed: entrySize,
      method: isDirectory ? '目录' : '存储',
      isDirectory,
    });
    offset += 512 + blocks * 512;
  }

  // 没读到结束块又没读完整个文件，说明窗口用尽
  const partial = !finished && window.length < size;
  return { entries, total, partial };
};

/** GZIP 里只有一个成员，名字与解压后大小分别写在头部与末尾 */
const listGzip = async (size: number, read: RangeReader, head: Uint8Array) => {
  const flags = head[3] ?? 0;
  let offset = 10;
  if (flags & 0x04) offset += 2 + ((head[offset] ?? 0) | ((head[offset + 1] ?? 0) << 8));
  let name = '';
  if (flags & 0x08) {
    const raw = head.subarray(offset, offset + 256);
    const end = raw.indexOf(0);
    name = decodeName(end < 0 ? raw : raw.subarray(0, end), false);
  }
  const tail = size >= 4 ? await read(size - 4, size) : new Uint8Array(0);
  const unpacked =
    tail.length === 4 ? tail[0] | (tail[1] << 8) | (tail[2] << 16) | (tail[3] << 24) : 0;
  return {
    entries: [{ name: name || '（未记录名称）', size: unpacked >>> 0, packed: size, method: 'Deflate', isDirectory: false }],
    total: 1,
  };
};

const UNSUPPORTED = '这种压缩包暂不支持查看内部文件列表';

/** 把扁平的条目路径拼成树，目录条目缺席或排在子项之后时按路径补出中间层级 */
export const buildArchiveTree = (entries: ArchiveEntry[]): ArchiveNode[] => {
  const roots: ArchiveNode[] = [];
  const dirs = new Map<string, ArchiveNode>();

  const dirChain = (segments: string[]) => {
    let children = roots;
    let prefix = '';
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let node = dirs.get(prefix);
      if (!node) {
        node = { name: segment, path: prefix, size: 0, method: '目录', isDirectory: true, children: [] };
        dirs.set(prefix, node);
        children.push(node);
      }
      children = node.children;
    }
    return children;
  };

  for (const entry of entries) {
    const parts = entry.name.split('/').filter(Boolean);
    if (!parts.length) continue;
    if (entry.isDirectory) {
      dirChain(parts);
      continue;
    }
    const leaf = parts[parts.length - 1];
    dirChain(parts.slice(0, -1)).push({
      name: leaf,
      path: entry.name,
      size: entry.size,
      method: entry.method,
      isDirectory: false,
      children: [],
    });
  }

  const byName = (a: ArchiveNode, b: ArchiveNode) =>
    a.isDirectory === b.isDirectory
      ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      : a.isDirectory
        ? -1
        : 1;
  const sortTree = (nodes: ArchiveNode[]) => {
    nodes.sort(byName);
    for (const node of nodes) if (node.children.length) sortTree(node.children);
  };
  sortTree(roots);
  return roots;
};

/**
 * 列出压缩包的条目。ZIP / tar / GZIP 能给出列表，
 * 其余封装只回报格式，条目留空
 */
export const listArchive = async (
  format: ArchiveFormat,
  size: number,
  read: RangeReader,
  head: Uint8Array
): Promise<ArchiveListing> => {
  const base = { format: FORMAT_LABELS[format], tree: [] as ArchiveNode[], count: 0, total: 0, truncated: false, note: '' };
  const finish = (result: { entries: ArchiveEntry[]; total: number; partial?: boolean }): ArchiveListing => {
    const count = result.entries.filter((entry) => !entry.isDirectory).length;
    return {
      ...base,
      tree: buildArchiveTree(result.entries),
      count,
      total: result.total,
      truncated: result.total > count || Boolean(result.partial),
    };
  };
  try {
    if (format === 'zip') return finish(await listZip(size, read));
    if (format === 'tar') return finish(await listTar(size, read));
    if (format === 'gzip') return finish(await listGzip(size, read, head));
  } catch (error) {
    return { ...base, note: `读取条目失败：${error instanceof Error ? error.message : String(error)}` };
  }
  return {
    ...base,
    note: format === 'bzip2' || format === 'xz' ? `${UNSUPPORTED}（只有一个文件，未记录文件名）` : UNSUPPORTED,
  };
};
