/**
 * 最小 ZIP 写入：只有本地文件头、中央目录与结尾记录三段
 * 名字一律按 UTF-8 写并置标志位，中文名在 Windows 与 Android 上都能还原
 */

/** 单个条目最多 4GB，超出要走 ZIP64，这里直接拒绝 */
const MAX_ENTRY = 0xffffffff;
/** 条目数与中央目录长度受结尾记录的字段宽度限制 */
const MAX_ENTRIES = 0xffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crcOf = (parts: Uint8Array[]) => {
  let crc = 0xffffffff;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      crc = CRC_TABLE[(crc ^ part[index]) & 0xff] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/** DOS 时间：日期与时间各占两个字节 */
const dosStamp = (ms: number) => {
  const date = new Date(ms);
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
};

/** 有 deflate-raw 就压，压缩后反而更大的一律按原样存 */
const deflate = async (parts: Uint8Array[]) => {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const blob = new Blob(parts as BlobPart[]);
    const stream = blob.stream().pipeThrough(new CompressionStream('deflate-raw'));
    const packed = new Uint8Array(await new Response(stream).arrayBuffer());
    return packed.length < parts.reduce((sum, part) => sum + part.length, 0) ? packed : null;
  } catch {
    // 浏览器不支持 deflate-raw
    return null;
  }
};

interface CentralRecord {
  name: Uint8Array;
  crc: number;
  size: number;
  packed: number;
  method: number;
  stamp: { time: number; date: number };
  offset: number;
  directory: boolean;
}

export interface ZipWriter {
  /** 追加一个文件或目录，目录的 name 以 / 结尾 */
  add: (name: string, parts: Uint8Array[], mtime: number) => Promise<void>;
  blob: () => Blob;
}

export const createZip = (): ZipWriter => {
  const parts: Uint8Array[] = [];
  const records: CentralRecord[] = [];
  let offset = 0;

  const add = async (name: string, chunks: Uint8Array[], mtime: number) => {
    const directory = name.endsWith('/');
    if (records.length >= MAX_ENTRIES) throw new Error('条目数太多，请分组打包');
    const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (size > MAX_ENTRY) throw new Error('单个文件超过 4GB，无法打包');

    const nameBytes = new TextEncoder().encode(name);
    const packed = directory || !size ? null : await deflate(chunks);
    const body = packed ? [packed] : chunks;
    const method = packed ? 8 : 0;
    const stamp = dosStamp(mtime);
    const crc = directory || !size ? 0 : crcOf(chunks);

    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    // 标志位 11 表示名字是 UTF-8
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, method, true);
    view.setUint16(10, stamp.time, true);
    view.setUint16(12, stamp.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, packed ? packed.length : size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, nameBytes.length, true);
    header.set(nameBytes, 30);

    parts.push(header, ...body);
    records.push({
      name: nameBytes,
      crc,
      size,
      packed: packed ? packed.length : size,
      method,
      stamp,
      offset,
      directory,
    });
    offset += header.length + (packed ? packed.length : size);
  };

  const blob = () => {
    const central: Uint8Array[] = [];
    let length = 0;
    for (const record of records) {
      const entry = new Uint8Array(46 + record.name.length);
      const view = new DataView(entry.buffer);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true);
      view.setUint16(10, record.method, true);
      view.setUint16(12, record.stamp.time, true);
      view.setUint16(14, record.stamp.date, true);
      view.setUint32(16, record.crc, true);
      view.setUint32(20, record.packed, true);
      view.setUint32(24, record.size, true);
      view.setUint16(28, record.name.length, true);
      // 目录置的是 MS-DOS 的目录属性位
      view.setUint32(38, record.directory ? 0x10 : 0, true);
      view.setUint32(42, record.offset, true);
      entry.set(record.name, 46);
      central.push(entry);
      length += entry.length;
    }

    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, records.length, true);
    view.setUint16(10, records.length, true);
    view.setUint32(12, length, true);
    view.setUint32(16, offset, true);

    return new Blob([...parts, ...central, end] as BlobPart[], { type: 'application/zip' });
  };

  return { add, blob };
};
