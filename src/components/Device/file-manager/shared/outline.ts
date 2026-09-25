/**
 * 章节标记识别：按逻辑行扫描原文，命中后给出标题与它在原文中的字符偏移
 * txt 预览的目录侧栏、电子书缺少自带目录时的补全都走这里
 */

export interface Chapter {
  /** 章节标题，已去掉两侧装饰符号并合并空白 */
  title: string;
  /** 标题所在行首在原文中的字符偏移 */
  offset: number;
}

/** 标题行长度上限，超过这个长度的行按正文处理 */
const MAX_TITLE_LENGTH = 40;
/** 识别条数上限，超长文本里不建出上万条目录 */
const MAX_CHAPTERS = 2000;

const NUMERAL = '[0-9零〇一二三四五六七八九十百千万两]';

/** 常见章节标题形式：第X章/节/回/卷、卷X、序章一类，以及英文章节 */
const PATTERNS: RegExp[] = [
  new RegExp(`^第\\s*${NUMERAL}{1,12}\\s*[章节節回卷篇部集话話幕]`),
  new RegExp(`^卷\\s*${NUMERAL}{1,12}`),
  /^(?:序章|序言|序幕|楔子|前言|引言|引子|后记|尾声|终章|尾章|外传|番外|附录|跋)/,
  /^(?:chapter|part|book)\s*(?:[0-9]{1,4}|[ivxlcdm]{1,8})(?![a-z0-9])/i,
];

/** 标题两侧的装饰符号，如 === 第一章 ===、【第一章】 */
const LEAD = /^[\s\u3000=#*\-—~>·[\]【】]+/;
const TAIL = /[\s\u3000=#*\-—~>·[\]【】]+$/;
/** 句子以句末标点收尾，标题不会 */
const SENTENCE_END = /[。！？]$/;

/** 判定一行是否为章节标题，命中时返回去掉装饰符号并合并空白后的标题 */
export const matchChapterTitle = (line: string): string | null => {
  if (!line || line.length > MAX_TITLE_LENGTH * 2) return null;
  const title = line.replace(LEAD, '').replace(TAIL, '').replace(/[\s\u3000]+/g, ' ').trim();
  if (!title || title.length > MAX_TITLE_LENGTH || SENTENCE_END.test(title)) return null;
  return PATTERNS.some((pattern) => pattern.test(title)) ? title : null;
};

/** 扫描全文，按出现顺序返回章节列表 */
export const findChapters = (text: string): Chapter[] => {
  const chapters: Chapter[] = [];
  let from = 0;

  while (from < text.length && chapters.length < MAX_CHAPTERS) {
    let end = text.indexOf('\n', from);
    if (end < 0) end = text.length;
    if (end - from <= MAX_TITLE_LENGTH) {
      const title = matchChapterTitle(text.slice(from, end));
      if (title) chapters.push({ title, offset: from });
    }
    from = end + 1;
  }

  return chapters;
};
