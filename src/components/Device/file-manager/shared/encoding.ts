/**
 * 文本编码的探测与解码：设备上的文本文件没有可信的元信息，
 * 只能依据 BOM 与字节特征推断
 */

export interface EncodingOption {
  /** TextDecoder 的标签 */
  value: string;
  name: string;
}

/**
 * 下拉里可选的编码，顺序按常见程度排，均为 WHATWG Encoding Standard 收录的标签
 * 共用同一个解码器的标签只留最常见的那个：gb2312 与 gbk 同一解码器，iso-8859-1 与 windows-1252 同一解码器
 */
export const ENCODINGS: EncodingOption[] = [
  { value: 'utf-8', name: 'UTF-8' },
  { value: 'gbk', name: 'GBK' },
  { value: 'gb18030', name: 'GB18030' },
  { value: 'big5', name: 'Big5' },
  { value: 'shift_jis', name: 'Shift_JIS' },
  { value: 'euc-jp', name: 'EUC-JP' },
  { value: 'euc-kr', name: 'EUC-KR' },
  { value: 'windows-1252', name: 'Windows-1252' },
  { value: 'windows-1251', name: 'Windows-1251' },
  { value: 'utf-16le', name: 'UTF-16 LE' },
  { value: 'utf-16be', name: 'UTF-16 BE' },
];

export const encodingName = (value: string) => ENCODINGS.find((item) => item.value === value)?.name ?? value.toUpperCase();

/**
 * 自动探测时的候选顺序，同分时取排在前面的那一个
 * GBK 在前、UTF-16 最后，中文按 UTF-16 解出的汉字不干扰结果排序
 */
const CANDIDATES = [
  'gbk',
  'gb18030',
  'big5',
  'shift_jis',
  'euc-jp',
  'euc-kr',
  'windows-1251',
  'windows-1252',
  'utf-16le',
  'utf-16be',
];

/** 容错解码里允许的替换字符占比，超过它才认为不是 UTF-8 */
const UTF8_BAD_LIMIT = 0.02;

/** 探测只取样文件头 */
const SAMPLE_BYTES = 64 * 1024;

const BOMS: { bytes: number[]; encoding: string }[] = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: 'utf-8' },
  { bytes: [0xff, 0xfe], encoding: 'utf-16le' },
  { bytes: [0xfe, 0xff], encoding: 'utf-16be' },
];

export const mergeChunks = (chunks: Uint8Array[]) => {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
};

/** 标签非法或解不出来时返回 null，不抛给调用方 */
const decodeAs = (bytes: Uint8Array, label: string, fatal: boolean): string | null => {
  try {
    return new TextDecoder(label, { fatal }).decode(bytes);
  } catch {
    return null;
  }
};

const matchesBom = (bytes: Uint8Array, bom: number[]) => bom.every((byte, index) => bytes[index] === byte);

/** 无 BOM 的 UTF-16 会在 ASCII 字符的高位夹杂大量 0x00，按零字节的奇偶位置判断字节序 */
const utf16Of = (bytes: Uint8Array): string | null => {
  const sample = bytes.subarray(0, 4096);
  if (sample.length < 16) return null;
  let even = 0;
  let odd = 0;
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] === 0) {
      if (index % 2) odd += 1;
      else even += 1;
    }
  }
  const zeros = even + odd;
  if (zeros < sample.length * 0.1) return null;
  if (odd > even * 3) return 'utf-16le';
  if (even > odd * 3) return 'utf-16be';
  return null;
};

/** 解不出来的字节在文本里的占比 */
const badRatio = (text: string) => {
  let bad = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0xfffd) bad += 1;
  }
  return text.length ? bad / text.length : 0;
};

/** 按字符落在常用区的比例打分，用来从候选编码中选出得分最高的一项 */
const score = (text: string) => {
  let total = 0;
  let good = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    total += 1;
    if (code === 0xfffd) continue; // 解不出来的字节
    if (code === 9 || code === 10 || code === 13) good += 1;
    else if (code < 0x20) continue; // 控制字符，多半是认错编码了
    else if (code < 0x80) good += 1;
    else if (code >= 0x4e00 && code <= 0x9fff) good += 1; // 常用汉字
    else if (code >= 0x3040 && code <= 0x30ff) good += 1; // 假名
    else if (code >= 0xac00 && code <= 0xd7af) good += 1; // 谚文音节
    else if ((code >= 0x1100 && code <= 0x11ff) || (code >= 0x3130 && code <= 0x318f)) good += 1; // 谚文字母与兼容字母
    else if (code >= 0x0400 && code <= 0x04ff) good += 1; // 西里尔字母
    else if (code >= 0xe000 && code <= 0xf8ff) good -= 2; // 私用区，基本是误判
    else if (code >= 0x3400 && code <= 0x4dbf) good -= 0.5; // 扩展 A，生僻字
    // 中文标点、全角字符与起始于 0xff61 的半角片假名不计入，中韩文本按日文编码解不会得满分
    else if ((code >= 0x3000 && code <= 0x303f) || (code >= 0xff01 && code <= 0xff60)) good += 1;
  }
  return total ? good / total : 0;
};

export interface DecodedText {
  encoding: string;
  text: string;
}

/** 探测编码并解出全文 */
export const detectEncoding = (bytes: Uint8Array): DecodedText => {
  for (const { bytes: bom, encoding } of BOMS) {
    if (matchesBom(bytes, bom)) {
      return { encoding, text: decodeAs(bytes, encoding, false) ?? '' };
    }
  }

  const utf16 = utf16Of(bytes);
  if (utf16) {
    const text = decodeAs(bytes, utf16, false);
    if (text !== null) return { encoding: utf16, text };
  }

  // 取样判断时可能截断最后一个多字节字符，先回退 3 个字节再判断
  const sample = bytes.length > SAMPLE_BYTES ? bytes.subarray(0, SAMPLE_BYTES - 3) : bytes;
  if (decodeAs(sample, 'utf-8', true) !== null) {
    return { encoding: 'utf-8', text: decodeAs(bytes, 'utf-8', false) ?? '' };
  }
  // 严格解码失败时常只是夹带了少量杂字节，按替换字符占比再给 UTF-8 一次机会
  const loose = decodeAs(sample, 'utf-8', false);
  if (loose !== null && badRatio(loose) <= UTF8_BAD_LIMIT) {
    return { encoding: 'utf-8', text: decodeAs(bytes, 'utf-8', false) ?? '' };
  }

  let best = { encoding: CANDIDATES[0], score: -Infinity };
  for (const label of CANDIDATES) {
    const probe = decodeAs(sample, label, false);
    if (probe === null) continue;
    const value = score(probe);
    if (value > best.score) best = { encoding: label, score: value };
  }
  return { encoding: best.encoding, text: decodeAs(bytes, best.encoding, false) ?? '' };
};

/** 指定编码解码；传空则先探测。返回实际用上的编码，供标题栏展示 */
export const decodeText = (bytes: Uint8Array, encoding?: string | null): DecodedText => {
  if (!encoding) return detectEncoding(bytes);
  const text = decodeAs(bytes, encoding, false);
  return text === null ? detectEncoding(bytes) : { encoding, text };
};
