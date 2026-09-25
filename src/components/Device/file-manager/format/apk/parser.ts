/**
 * APK 解析：先读 ZIP 中央目录得到条目表，再按需读取 AndroidManifest.xml、
 * resources.arsc 与图标这几个条目的字节，整个安装包不进内存
 */

import { decodeUtf16, readZipEntries, readZipEntryData, type RangeReader } from '../../device/zip';

/** 中央目录前的签名块标识，出现即说明有 v2/v3 签名 */
const SIGNING_BLOCK_MAGIC = 'APK Sig Block 42';

const view = (buffer: Uint8Array, offset = 0) =>
  new DataView(buffer.buffer, buffer.byteOffset + offset, buffer.byteLength - offset);

const textDecoder = new TextDecoder('utf-8');

/* ------------------------------ 二进制 XML ------------------------------ */

const CHUNK_STRING_POOL = 0x0001;
const CHUNK_START_ELEMENT = 0x0102;
const CHUNK_END_ELEMENT = 0x0103;

const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_FLOAT = 0x04;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;

export interface AxmlNode {
  name: string;
  attributes: Record<string, string>;
  children: AxmlNode[];
}

const readUtf8String = (buffer: Uint8Array, start: number) => {
  let position = start;
  let length = buffer[position];
  position += 1;
  if (length & 0x80) {
    length = ((length & 0x7f) << 8) | buffer[position];
    position += 1;
  }
  let bytes = buffer[position];
  position += 1;
  if (bytes & 0x80) {
    bytes = ((bytes & 0x7f) << 8) | buffer[position];
    position += 1;
  }
  return textDecoder.decode(buffer.subarray(position, position + bytes));
};

const readUtf16String = (buffer: Uint8Array, start: number) => {
  const data = view(buffer);
  let position = start;
  let length = data.getUint16(position, true);
  position += 2;
  if (length & 0x8000) {
    length = ((length & 0x7fff) << 16) | data.getUint16(position, true);
    position += 2;
  }
  return decodeUtf16(buffer.subarray(position, position + length * 2));
};

const readStringPool = (buffer: Uint8Array, offset: number) => {
  const data = view(buffer);
  const count = data.getUint32(offset + 8, true);
  const flags = data.getUint32(offset + 16, true);
  const stringsStart = data.getUint32(offset + 20, true);
  const headerSize = data.getUint16(offset + 2, true);
  const utf8 = (flags & 0x100) !== 0;
  const strings: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const stringOffset = data.getUint32(offset + headerSize + index * 4, true);
    const start = offset + stringsStart + stringOffset;
    if (start >= buffer.length) {
      strings.push('');
      continue;
    }
    strings.push(utf8 ? readUtf8String(buffer, start) : readUtf16String(buffer, start));
  }
  return strings;
};

const formatValue = (dataType: number, data: number, pool: string[]) => {
  switch (dataType) {
    case TYPE_STRING:
      return pool[data] ?? '';
    case TYPE_INT_BOOLEAN:
      return data !== 0 ? 'true' : 'false';
    case TYPE_INT_HEX:
      return `0x${(data >>> 0).toString(16)}`;
    case TYPE_FLOAT:
      return String(new Float32Array(new Uint32Array([data]).buffer)[0]);
    case TYPE_INT_DEC:
      return String(data | 0);
    case TYPE_REFERENCE:
      return `@${(data >>> 0).toString(16).padStart(8, '0')}`;
    default:
      return String(data >>> 0);
  }
};

/** 解析 Android 二进制 XML：清单、自适应图标等 */
export const parseBinaryXml = (buffer: Uint8Array) => {
  const data = view(buffer);
  let pool: string[] = [];
  let root: AxmlNode | null = null;
  const stack: AxmlNode[] = [];
  let offset = 8;

  while (offset + 8 <= buffer.length) {
    const type = data.getUint16(offset, true);
    const chunkSize = data.getUint32(offset + 4, true);
    if (chunkSize < 8) break;

    if (type === CHUNK_STRING_POOL) {
      pool = readStringPool(buffer, offset);
    } else if (type === CHUNK_START_ELEMENT) {
      // chunk 头之后是 attrExt：ns、name、attributeStart、attributeSize、attributeCount...
      const headerSize = data.getUint16(offset + 2, true);
      const extension = offset + headerSize;
      const nameIndex = data.getUint32(extension + 4, true);
      // attributeStart 相对 header 之后算起，属性区紧跟 attrExt
      const attributeStart = headerSize + data.getUint16(extension + 8, true);
      const attributeSize = data.getUint16(extension + 10, true) || 20;
      const attributeCount = data.getUint16(extension + 12, true);
      const node: AxmlNode = { name: pool[nameIndex] ?? '', attributes: {}, children: [] };

      for (let index = 0; index < attributeCount; index += 1) {
        const attribute = offset + attributeStart + index * attributeSize;
        if (attribute + 20 > buffer.length) break;
        const attributeName = pool[data.getUint32(attribute + 4, true)] ?? '';
        const rawValue = data.getUint32(attribute + 8, true);
        const dataType = data.getUint8(attribute + 15);
        const value = data.getUint32(attribute + 16, true);
        node.attributes[attributeName] =
          rawValue !== 0xffffffff ? (pool[rawValue] ?? '') : formatValue(dataType, value, pool);
      }

      if (stack.length) stack[stack.length - 1].children.push(node);
      else root ??= node;
      stack.push(node);
    } else if (type === CHUNK_END_ELEMENT) {
      stack.pop();
    }

    offset += chunkSize;
  }

  if (!root) throw new Error('二进制 XML 解析失败');
  return root;
};

/* ----------------------------- 资源表（arsc） ----------------------------- */

const RES_TABLE_PACKAGE_TYPE = 0x0200;
const RES_TABLE_TYPE_TYPE = 0x0201;
const FLAG_COMPLEX = 0x0001;

/** 资源 id → 各配置下的取值，用于把 @7f08xxxx 解析成字符串或文件路径 */
type ResourceTable = Map<number, { density: number; value: string; dataType: number }[]>;

const parseResourceTable = (buffer: Uint8Array) => {
  const data = view(buffer);
  const table: ResourceTable = new Map();
  let globals: string[] = [];
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const type = data.getUint16(offset, true);
    const chunkSize = data.getUint32(offset + 4, true);
    if (chunkSize < 8) break;

    if (type === CHUNK_STRING_POOL) {
      globals = readStringPool(buffer, offset);
    } else if (type === RES_TABLE_PACKAGE_TYPE) {
      const packageId = data.getUint32(offset + 8, true);
      const headerSize = data.getUint16(offset + 2, true);
      let inner = offset + headerSize;
      const end = offset + chunkSize;

      while (inner + 8 <= end) {
        const innerType = data.getUint16(inner, true);
        const innerSize = data.getUint32(inner + 4, true);
        if (innerSize < 8) break;

        if (innerType === RES_TABLE_TYPE_TYPE) {
          const typeId = data.getUint8(inner + 8);
          const entryCount = data.getUint32(inner + 12, true);
          const entriesStart = data.getUint32(inner + 16, true);
          const configSize = data.getUint32(inner + 20, true);
          // density 在 ResTable_config 的第 14 个字节起
          const density = configSize >= 16 ? data.getUint16(inner + 20 + 14, true) : 0;
          const offsetsStart = inner + 20 + configSize;

          for (let index = 0; index < entryCount; index += 1) {
            const entryOffset = data.getUint32(offsetsStart + index * 4, true);
            if (entryOffset === 0xffffffff) continue;
            const entry = inner + entriesStart + entryOffset;
            if (entry + 8 > buffer.length) continue;
            const flags = data.getUint16(entry + 2, true);
            if (flags & FLAG_COMPLEX) continue;
            const valueOffset = entry + 8;
            if (valueOffset + 8 > buffer.length) continue;
            const dataType = data.getUint8(valueOffset + 3);
            const value = data.getUint32(valueOffset + 4, true);
            const id = (packageId << 24) | (typeId << 16) | index;
            const list = table.get(id) ?? [];
            list.push({
              density,
              dataType,
              value: dataType === TYPE_STRING ? (globals[value] ?? '') : String(value),
            });
            table.set(id, list);
          }
        }

        inner += innerSize;
      }
    }

    offset += chunkSize;
  }

  return table;
};

const resolveReference = (table: ResourceTable, attribute?: string) => {
  if (!attribute?.startsWith('@')) return null;
  const id = Number.parseInt(attribute.slice(1), 16);
  const variants = table.get(id);
  return variants?.length ? variants : null;
};

/** 取配置里最合适的一条：优先位图路径，其次字符串 */
const pickVariant = (variants: { density: number; value: string }[], pattern: RegExp) => {
  const matched = variants.filter((item) => pattern.test(item.value));
  if (!matched.length) return null;
  return matched.sort((a, b) => b.density - a.density)[0];
};

/* -------------------------------- 顶层信息 -------------------------------- */

export interface ApkComponent {
  name: string;
  exported: string;
  launcher: boolean;
}

export interface ApkInfo {
  packageName: string;
  versionName: string;
  versionCode: string;
  minSdk: string;
  targetSdk: string;
  compileSdk: string;
  label: string;
  icon: { path: string; data: Uint8Array } | null;
  permissions: string[];
  features: string[];
  activities: ApkComponent[];
  services: ApkComponent[];
  receivers: ApkComponent[];
  providers: ApkComponent[];
  abis: string[];
  dexFiles: number;
  signatureFiles: string[];
  signedBlock: boolean;
  entryCount: number;
  unpackedSize: number;
}

const attributeOf = (node: AxmlNode, ...names: string[]) => {
  for (const name of names) {
    const value = node.attributes[name];
    if (value !== undefined && value !== '') return value;
  }
  return '';
};

const collectComponents = (application: AxmlNode, tag: string): ApkComponent[] =>
  application.children
    .filter((child) => child.name === tag)
    .map((child) => ({
      name: attributeOf(child, 'name'),
      exported: attributeOf(child, 'exported'),
      launcher: child.children.some(
        (filter) =>
          filter.name === 'intent-filter' &&
          filter.children.some(
            (action) =>
              action.name === 'action' &&
              attributeOf(action, 'name') === 'android.intent.action.MAIN'
          ) &&
          filter.children.some(
            (category) =>
              category.name === 'category' &&
              attributeOf(category, 'name') === 'android.intent.category.LAUNCHER'
          )
      ),
    }));

const digitOf = (value: string) => /^\d+$/.test(value);

export const analyzeApk = async (size: number, read: RangeReader): Promise<ApkInfo> => {
  const { entries, dirOffset } = await readZipEntries(size, read);
  const find = (name: string) => entries.find((entry) => entry.name === name);

  const manifestEntry = find('AndroidManifest.xml');
  if (!manifestEntry) throw new Error('安装包里没有 AndroidManifest.xml');
  const manifest = parseBinaryXml(await readZipEntryData(manifestEntry, read));

  const application = manifest.children.find((child) => child.name === 'application');
  if (!application) throw new Error('清单里没有 application 节点');
  const usesSdk = manifest.children.find((child) => child.name === 'uses-sdk');

  const arscEntry = find('resources.arsc');
  let table: ResourceTable | null = null;
  if (arscEntry) {
    try {
      table = parseResourceTable(await readZipEntryData(arscEntry, read));
    } catch {
      table = null;
    }
  }

  const labelAttribute = attributeOf(application, 'label');
  let label = labelAttribute;
  if (table && labelAttribute.startsWith('@')) {
    const variant = pickVariant(resolveReference(table, labelAttribute) ?? [], /./);
    if (variant) label = variant.value;
  }

  /** 图标可能是位图，也可能只是指向自适应图标 xml */
  let iconPath = '';
  if (table) {
    const variants = resolveReference(table, attributeOf(application, 'icon'));
    const bitmap = variants ? pickVariant(variants, /\.(png|webp|jpe?g)$/i) : null;
    if (bitmap) {
      iconPath = bitmap.value;
    } else if (variants) {
      const xml = pickVariant(variants, /\.xml$/i);
      const iconEntry = xml ? find(xml.value) : null;
      if (iconEntry) {
        try {
          const nodes = parseBinaryXml(await readZipEntryData(iconEntry, read));
          const foreground = nodes.children[0]?.children
            .map((child) => attributeOf(child, 'drawable'))
            .find(Boolean);
          const inner = resolveReference(table, foreground);
          const innerBitmap = inner ? pickVariant(inner, /\.(png|webp|jpe?g)$/i) : null;
          if (innerBitmap) iconPath = innerBitmap.value;
        } catch {
          /* 自适应图标解析失败时就不显示图标 */
        }
      }
    }
  }

  let icon: ApkInfo['icon'] = null;
  const iconEntry = iconPath ? entries.find((entry) => entry.name === iconPath) : null;
  if (iconEntry) {
    try {
      icon = { path: iconEntry.name, data: await readZipEntryData(iconEntry, read) };
    } catch {
      icon = null;
    }
  }

  const permissions = manifest.children
    .filter((child) => child.name === 'uses-permission' || child.name === 'uses-permission-sdk-23')
    .map((child) => attributeOf(child, 'name'))
    .filter(Boolean);

  const features = manifest.children
    .filter((child) => child.name === 'uses-feature')
    .map((child) => attributeOf(child, 'name'))
    .filter(Boolean);

  const abis = [
    ...new Set(
      entries
        .filter((entry) => entry.name.startsWith('lib/'))
        .map((entry) => entry.name.split('/')[1])
        .filter(Boolean)
    ),
  ].sort();

  const versionCode = attributeOf(manifest, 'versionCode', 'versionCodeMajor');
  return {
    packageName: attributeOf(manifest, 'package'),
    versionName: attributeOf(manifest, 'versionName'),
    versionCode: digitOf(versionCode) ? versionCode : '',
    minSdk: usesSdk ? attributeOf(usesSdk, 'minSdkVersion') : '',
    targetSdk: usesSdk ? attributeOf(usesSdk, 'targetSdkVersion') : '',
    compileSdk: attributeOf(manifest, 'compileSdkVersion', 'platformBuildVersionCode'),
    label,
    icon,
    permissions,
    features,
    activities: collectComponents(application, 'activity'),
    services: collectComponents(application, 'service'),
    receivers: collectComponents(application, 'receiver'),
    providers: collectComponents(application, 'provider'),
    abis,
    dexFiles: entries.filter((entry) => /^classes\d*\.dex$/.test(entry.name)).length,
    signatureFiles: entries.filter((entry) => /^META-INF\/.*\.(RSA|DSA|EC)$/i.test(entry.name)).map((entry) => entry.name),
    signedBlock: await hasSigningBlock(dirOffset, read),
    entryCount: entries.length,
    unpackedSize: entries.reduce((sum, entry) => sum + entry.size, 0),
  };
};

/** 中央目录前紧邻的签名块，出现即说明有 v2 或 v3 签名 */
const hasSigningBlock = async (dirOffset: number, read: RangeReader) => {
  if (dirOffset < 32) return false;
  try {
    const tail = await read(dirOffset - 32, dirOffset);
    return textDecoder.decode(tail).includes(SIGNING_BLOCK_MAGIC);
  } catch {
    return false;
  }
};

