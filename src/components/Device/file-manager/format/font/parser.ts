/** 只解析元数据需要的表：name、maxp 等 */

export interface FontInfo {
  /** TrueType / OpenType / WOFF / WOFF2 */
  format: string;
  family: string;
  subfamily: string;
  version: string;
  /** 字形总数 */
  glyphs: number;
  /** 字体里的表数量 */
  tables: number;
  /** 未能取到元数据时的说明 */
  note: string;
}

const tagAt = (bytes: Uint8Array, offset: number) =>
  String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);

const be16 = (bytes: Uint8Array, offset: number) => ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);

const be32 = (bytes: Uint8Array, offset: number) =>
  (((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)) >>> 0;

/** woff 的每张表都是独立的 zlib 流 */
const inflate = async (bytes: Uint8Array) => {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

type TableReader = (name: string) => Promise<Uint8Array | null>;

interface FontTables {
  format: string;
  count: number;
  table: TableReader;
}

const readSfnt = (data: Uint8Array): FontTables => {
  const count = be16(data, 4);
  const tables = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 16;
    if (at + 16 > data.length) break;
    const offset = be32(data, at + 8);
    const length = be32(data, at + 12);
    if (offset + length > data.length || !length) continue;
    tables.set(tagAt(data, at), data.subarray(offset, offset + length));
  }
  return {
    format: tagAt(data, 0) === 'OTTO' ? 'OpenType' : 'TrueType',
    count,
    table: async (name) => tables.get(name) ?? null,
  };
};

const readWoff = (data: Uint8Array): FontTables => {
  const count = be16(data, 12);
  const records = new Map<string, { offset: number; packed: number; size: number }>();
  for (let index = 0; index < count; index += 1) {
    const at = 44 + index * 20;
    if (at + 20 > data.length) break;
    records.set(tagAt(data, at), {
      offset: be32(data, at + 4),
      packed: be32(data, at + 8),
      size: be32(data, at + 12),
    });
  }
  return {
    format: 'WOFF',
    count,
    table: async (name) => {
      const record = records.get(name);
      if (!record || record.offset + record.packed > data.length) return null;
      const raw = data.subarray(record.offset, record.offset + record.packed);
      return record.packed === record.size ? raw : inflate(raw);
    },
  };
};

/** woff2 的表是整体 brotli 压缩，浏览器没有对应接口，只回报格式与表数量 */
const readWoff2 = (data: Uint8Array): FontTables => ({
  format: 'WOFF2',
  count: be16(data, 12),
  table: async () => null,
});

const readTables = (data: Uint8Array): FontTables => {
  const magic = tagAt(data, 0);
  if (magic === 'wOF2') return readWoff2(data);
  if (magic === 'wOFF') return readWoff(data);
  return readSfnt(data);
};

/** name 表里同一个名字会按平台各存一份，按平台与语言打分保留分值最高的一份 */
const decodeNames = (table: Uint8Array) => {
  const count = be16(table, 2);
  const storage = be16(table, 4);
  const best = new Map<number, { score: number; text: string }>();
  const decoders = new Map<string, TextDecoder>();

  for (let index = 0; index < count; index += 1) {
    const at = 6 + index * 12;
    if (at + 12 > table.length) break;
    const platform = be16(table, at);
    const language = be16(table, at + 4);
    const nameId = be16(table, at + 6);
    const length = be16(table, at + 8);
    const offset = be16(table, at + 10);
    if (nameId > 6 || !length || storage + offset + length > table.length) continue;

    const utf16 = platform === 0 || platform === 3;
    const encoding = utf16 ? 'utf-16be' : 'windows-1252';
    let decoder = decoders.get(encoding);
    if (!decoder) {
      try {
        decoder = new TextDecoder(encoding);
      } catch {
        decoder = new TextDecoder();
      }
      decoders.set(encoding, decoder);
    }

    const text = decoder.decode(table.subarray(storage + offset, storage + offset + length)).replace(/\0/g, '').trim();
    if (!text) continue;

    const score = (platform === 3 ? 2 : platform === 0 ? 1 : 0) + (language === 0x0409 || language === 0 ? 1 : 0);
    const previous = best.get(nameId);
    if (!previous || score > previous.score) best.set(nameId, { score, text });
  }

  return (nameId: number) => best.get(nameId)?.text ?? '';
};

export const analyzeFont = async (data: Uint8Array): Promise<FontInfo> => {
  const { format, count, table } = readTables(data);
  const info: FontInfo = { format, family: '', subfamily: '', version: '', glyphs: 0, tables: count, note: '' };

  const names = await table('name');
  if (names) {
    const read = decodeNames(names);
    info.family = read(1) || read(4);
    info.subfamily = read(2);
    info.version = read(5);
  } else if (format === 'WOFF2') {
    info.note = 'WOFF2 整体 brotli 压缩，未解析元数据';
  } else {
    info.note = '未找到字体名称表';
  }

  const maxp = await table('maxp');
  if (maxp && maxp.length >= 6) info.glyphs = be16(maxp, 4);

  return info;
};
