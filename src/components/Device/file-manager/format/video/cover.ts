/**
 * 视频容器的内嵌封面：带海报的 MP4 会在 moov/udta 下写入一个 covr 条目，
 * 取出图片字节即可作为缩略图
 */

import type { RangeReader } from '../../device/zip';

/** 封面在文件两端附近，各取一段扫描即可覆盖 moov 在前或在后两种排布 */
const SCAN_BYTES = 256 * 1024;
/** 单张封面的体积上限，超出按结构异常处理 */
const COVER_MAX_SIZE = 8 * 1024 * 1024;
/** data box 的头部长度：size、标识、类型、区域标记 */
const DATA_HEADER = 16;

const COVR = [0x63, 0x6f, 0x76, 0x72];
const DATA = [0x64, 0x61, 0x74, 0x61];

/** data box 里声明的图片格式 */
const KNOWN_TYPES: Record<number, string> = {
  13: 'image/jpeg',
  14: 'image/png',
  27: 'image/bmp',
};

const uint32 = (buffer: Uint8Array, offset: number) =>
  ((buffer[offset] << 24) | (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3]) >>> 0;

const indexOfBytes = (buffer: Uint8Array, needle: number[], from: number) => {
  const last = buffer.length - needle.length;
  outer: for (let start = Math.max(0, from); start <= last; start += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (buffer[start + index] !== needle[index]) continue outer;
    }
    return start;
  }
  return -1;
};

const sniffImageType = (head: Uint8Array) => {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png';
  return '';
};

interface CoverRef {
  offset: number;
  length: number;
  mime: string;
}

/** covr 是容器 box，紧随其后的 data box 里才是图片字节 */
const parseCover = (buffer: Uint8Array, at: number): CoverRef | null => {
  const boxStart = at - 4;
  if (boxStart < 0) return null;
  const dataStart = at + 4;
  if (dataStart + DATA_HEADER > buffer.length) return null;
  const boxSize = uint32(buffer, boxStart);
  const dataSize = uint32(buffer, dataStart);
  // covr 至少装得下一个 data box，两处尺寸都要落在合理区间
  if (boxSize < DATA_HEADER + 8 || dataSize < DATA_HEADER || dataSize > COVER_MAX_SIZE) return null;
  if (indexOfBytes(buffer, DATA, dataStart + 4) !== dataStart + 4) return null;
  const flag = uint32(buffer, dataStart + 8) & 0x00ffffff;
  const head = buffer.subarray(dataStart + DATA_HEADER, dataStart + DATA_HEADER + 4);
  const mime = KNOWN_TYPES[flag] || sniffImageType(head);
  if (!mime) return null;
  return { offset: dataStart + DATA_HEADER, length: dataSize - DATA_HEADER, mime };
};

/** 二进制里出现 covr 字样可能是巧合，要求后续结构完全自洽才算命中 */
const findCover = (buffer: Uint8Array, base: number): CoverRef | null => {
  for (let at = indexOfBytes(buffer, COVR, 0); at >= 0; at = indexOfBytes(buffer, COVR, at + 4)) {
    const cover = parseCover(buffer, at);
    if (cover) return { ...cover, offset: base + cover.offset };
  }
  return null;
};

/** 取到内嵌封面就返回图片，没有或读取失败返回 null，由调用方改用抽帧 */
export const embeddedCoverBlob = async (size: number, read: RangeReader): Promise<Blob | null> => {
  if (!size) return null;
  const windows: [number, number][] = [[0, Math.min(size, SCAN_BYTES)]];
  if (size > SCAN_BYTES) windows.push([size - SCAN_BYTES, size]);

  for (const [start, end] of windows) {
    let buffer: Uint8Array;
    try {
      buffer = await read(start, end);
    } catch {
      return null;
    }
    const cover = findCover(buffer, start);
    if (!cover) continue;

    const local = cover.offset - start;
    if (local >= 0 && local + cover.length <= buffer.length) {
      return new Blob([buffer.slice(local, local + cover.length) as BlobPart], { type: cover.mime });
    }
    try {
      const data = await read(cover.offset, cover.offset + cover.length);
      if (data.length) return new Blob([data as BlobPart], { type: cover.mime });
    } catch {
      /* 这一段读取失败就继续查看另一个窗口 */
    }
  }
  return null;
};
