/**
 * ZIP 结构的按需读取：先读中央目录得到条目表，再按条目读回数据
 * APK、压缩包列表与视频封面都建立在这套基元上，因此它不与任何文件类型耦合
 */

/** 分段读取接口，调用方决定数据来自设备、Service Worker 还是本地文件 */
export type RangeReader = (start: number, end: number) => Promise<Uint8Array>;

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_COMMENT = 65535;

const view = (buffer: Uint8Array, offset = 0) =>
  new DataView(buffer.buffer, buffer.byteOffset + offset, buffer.byteLength - offset);

const textDecoder = new TextDecoder('utf-8');
const utf16Decoder = new TextDecoder('utf-16le');
/** 未声明 UTF-8 的条目名按本地代码页解码，中文压缩包多为 GBK */
const legacyDecoder = (() => {
  try {
    return new TextDecoder('gbk');
  } catch {
    return null;
  }
})();

const isAscii = (bytes: Uint8Array) => {
  for (const byte of bytes) {
    if (byte >= 0x80) return false;
  }
  return true;
};

/**
 * 条目名的编码无法直接判断：规范规定未置 UTF-8 标志位时使用本地代码页，
 * 但有些工具会写 UTF-8 却不置标志位，因此先按 UTF-8 解码
 */
export const decodeName = (bytes: Uint8Array, utf8: boolean) => {
  if (utf8 || !legacyDecoder || isAscii(bytes)) return textDecoder.decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return legacyDecoder.decode(bytes);
  }
};

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const findEocd = (tail: Uint8Array) => {
  if (tail.length < 22) return -1;
  const data = view(tail);
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (data.getUint32(index, true) === EOCD_SIGNATURE) return index;
  }
  return -1;
};

/** 读 ZIP 中央目录，返回条目表与目录起点，供判断前面是否存在签名块 */
export const readZipEntries = async (size: number, read: RangeReader) => {
  const tailLength = Math.min(size, MAX_COMMENT + 22);
  const tail = await read(size - tailLength, size);
  const tailView = view(tail);
  const eocd = findEocd(tail);
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件');

  let entryCount = tailView.getUint16(eocd + 10, true);
  let dirSize = tailView.getUint32(eocd + 12, true);
  let dirOffset = tailView.getUint32(eocd + 16, true);

  if (dirOffset === 0xffffffff || entryCount === 0xffff) {
    const locator = eocd - 20;
    if (locator < 0 || tailView.getUint32(locator, true) !== ZIP64_LOCATOR_SIGNATURE) {
      throw new Error('ZIP64 结构不完整');
    }
    const recordOffset = Number(tailView.getBigUint64(locator + 8, true));
    const record = view(await read(recordOffset, recordOffset + 56));
    if (record.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE) throw new Error('ZIP64 记录异常');
    entryCount = Number(record.getBigUint64(32, true));
    dirSize = Number(record.getBigUint64(40, true));
    dirOffset = Number(record.getBigUint64(48, true));
  }

  const dir = await read(dirOffset, dirOffset + dirSize);
  const dirView = view(dir);
  const entries: ZipEntry[] = [];
  let position = 0;

  while (position + 46 <= dir.length && dirView.getUint32(position, true) === CENTRAL_SIGNATURE) {
    const flags = dirView.getUint16(position + 8, true);
    const method = dirView.getUint16(position + 10, true);
    let compressedSize = dirView.getUint32(position + 20, true);
    let uncompressedSize = dirView.getUint32(position + 24, true);
    const nameLength = dirView.getUint16(position + 28, true);
    const extraLength = dirView.getUint16(position + 30, true);
    const commentLength = dirView.getUint16(position + 32, true);
    let offset = dirView.getUint32(position + 42, true);
    const name = decodeName(dir.subarray(position + 46, position + 46 + nameLength), (flags & 0x0800) !== 0);

    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || offset === 0xffffffff) {
      let extra = position + 46 + nameLength;
      const extraEnd = extra + extraLength;
      while (extra + 4 <= extraEnd) {
        const id = dirView.getUint16(extra, true);
        const length = dirView.getUint16(extra + 2, true);
        if (id === 0x0001) {
          let cursor = extra + 4;
          if (uncompressedSize === 0xffffffff) {
            uncompressedSize = Number(dirView.getBigUint64(cursor, true));
            cursor += 8;
          }
          if (compressedSize === 0xffffffff) {
            compressedSize = Number(dirView.getBigUint64(cursor, true));
            cursor += 8;
          }
          if (offset === 0xffffffff) offset = Number(dirView.getBigUint64(cursor, true));
          break;
        }
        extra += 4 + length;
      }
    }

    entries.push({ name, method, compressedSize, size: uncompressedSize, offset });
    position += 46 + nameLength + extraLength + commentLength;
  }

  return { entries, dirOffset };
};

const inflateRaw = async (data: Uint8Array) => {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** 按本地文件头定位数据区，压缩过的条目在此解压 */
export const readZipEntryData = async (entry: ZipEntry, read: RangeReader) => {
  const header = await read(entry.offset, entry.offset + 30);
  const headerView = view(header);
  if (headerView.getUint32(0, true) !== LOCAL_SIGNATURE) throw new Error('本地文件头异常');
  const start = entry.offset + 30 + headerView.getUint16(26, true) + headerView.getUint16(28, true);
  const raw = await read(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error(`条目 ${entry.name} 使用了不支持的压缩方式，无法解压`);
  return await inflateRaw(raw);
};

/** 二进制 XML 与资源表里的字符串多为 UTF-16，单独解码 */
export const decodeUtf16 = (bytes: Uint8Array) => utf16Decoder.decode(bytes);
