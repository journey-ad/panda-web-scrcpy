/**
 * 电子书解析：epub 与 mobi 的容器格式交给解析库，正文按章取回，
 * 书内图片由解析库替换为可用的对象地址；两种格式统一成「书名 + 目录 + 按章取正文」，
 * 排版交给预览组件
 */

import type { EpubToc } from '@lingo-reader/epub-parser';
import type { MobiTocItem } from '@lingo-reader/mobi-parser';

import { matchChapterTitle } from '../../shared/outline';

export interface EbookChapter {
  /** 取正文时用的章节标识 */
  id: string;
  title: string;
  /** 章节内部的定位选择器，为空表示从章节开头看起 */
  anchor: string;
  /** 目录里的缩进层级 */
  level: number;
}

export interface EbookContent {
  html: string;
  /** 从正文里取到的标题，没有则为空串 */
  title: string;
}

export interface Ebook {
  title: string;
  author: string;
  chapters: EbookChapter[];
  load: (id: string) => Promise<EbookContent>;
  /** 释放解析库创建的对象地址 */
  destroy: () => void;
}

/** 书里的脚本、样式与外链一律丢弃，只留正文结构 */
const DROPPED = 'script, style, link, iframe, object, embed, meta, base, form';

/**
 * 解析库的 path 垫片在参数不是绝对路径时会去取进程工作目录，浏览器里没有这个目录
 * 保存目录写成绝对路径即可避开
 */
const RESOURCE_DIR = '/__ebook';

/** 解析器不执行脚本，重排后的结构一并修掉书里不合规的标签 */
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

/** 去掉脚本、内联事件与脚本地址，正文以外的内容不影响渲染 */
const clean = (html: string) => {
  const doc = parse(html);
  doc.querySelectorAll(DROPPED).forEach((node) => node.remove());
  doc.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) element.removeAttribute(attribute.name);
      else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  return doc.body.innerHTML;
};

/** 正文里第一个标题节点的文本，用来补目录条目名 */
const headingOf = (html: string) => {
  const node = parse(html).querySelector('h1, h2, h3, h4, h5, h6, title');
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
};

/** 目录缺条目名时先留空，正文载入后由预览组件按正文标题补上 */
const openEpub = async (bytes: Uint8Array): Promise<Ebook> => {
  const { initEpubFile } = await import('@lingo-reader/epub-parser');
  // 浏览器版解析器用 FileReader 读取输入，只能接收 Blob 或 File
  const source = new File([bytes as BlobPart], 'book.epub', { type: 'application/epub+zip' });
  const file = await initEpubFile(source, RESOURCE_DIR);
  const metadata = file.getMetadata();
  const chapters: EbookChapter[] = [];

  const walk = (nodes: EpubToc, level: number) => {
    for (const node of nodes) {
      const resolved = file.resolveHref(node.href);
      if (resolved) chapters.push({ id: resolved.id, title: node.label, anchor: resolved.selector, level });
      if (node.children?.length) walk(node.children, resolved ? level + 1 : level);
    }
  };
  walk(file.getToc(), 0);

  // 没有目录文件的书按阅读顺序列出，条目名等正文加载后再补
  if (!chapters.length) {
    file.getSpine().forEach((item) => chapters.push({ id: item.id, title: '', anchor: '', level: 0 }));
  }

  return {
    title: metadata.title ?? '',
    author: (metadata.creator ?? []).map((item) => item.contributor).filter(Boolean).join('、'),
    chapters,
    load: async (id) => {
      const chapter = await file.loadChapter(id);
      return { html: clean(chapter.html), title: headingOf(chapter.html) };
    },
    destroy: () => file.destroy(),
  };
};

/** 正文没有分页标记时按标题块拆分，拆分出的内容留在内存里按 id 读取 */
const splitByHeading = (html: string) => {
  const doc = parse(html);
  const groups: { title: string; html: string }[] = [];
  let title = '';
  let bucket: string[] = [];

  const flush = () => {
    if (bucket.length) groups.push({ title, html: bucket.join('') });
    bucket = [];
  };

  for (const block of Array.from(doc.body.children)) {
    const heading = matchChapterTitle((block.textContent ?? '').trim());
    if (heading) {
      flush();
      title = heading;
    }
    bucket.push(block.outerHTML);
  }
  flush();

  return groups.length > 1 ? groups : [];
};

/** 书内锚点就是正文里的 <a filepos="N">，补上 id 后目录选择器才定位得到 */
const withAnchorIds = (html: string) => {
  const doc = parse(html);
  doc.querySelectorAll('a[href^="filepos:"]').forEach((node) => {
    const id = node.getAttribute('href');
    if (id) node.id = id;
  });
  return doc.body.innerHTML;
};

const openMobi = async (bytes: Uint8Array): Promise<Ebook> => {
  const { initMobiFile } = await import('@lingo-reader/mobi-parser');
  const file = await initMobiFile(bytes);
  const metadata = file.getMetadata();
  const chapters: EbookChapter[] = [];
  const splits = new Map<string, string>();

  const walk = (nodes: MobiTocItem[], level: number) => {
    for (const node of nodes) {
      const resolved = file.resolveHref(node.href);
      if (resolved) chapters.push({ id: resolved.id, title: node.label, anchor: resolved.selector, level });
      if (node.children?.length) walk(node.children, level + 1);
    }
  };
  walk(file.getToc(), 0);

  // 没有目录的书按分页标记拆分出的正文段落列出，单段正文再按标题块拆分
  if (!chapters.length) {
    const spine = file.getSpine();
    if (spine.length > 1) {
      spine.forEach((item) => {
        chapters.push({ id: item.id, title: headingOf(item.text), anchor: '', level: 0 });
      });
    } else if (spine.length === 1) {
      splitByHeading(spine[0].text).forEach((group, index) => {
        const id = `split-${index}`;
        splits.set(id, group.html);
        chapters.push({ id, title: group.title, anchor: '', level: 0 });
      });
      if (!chapters.length) {
        const { id, text } = spine[0];
        chapters.push({ id, title: headingOf(text), anchor: '', level: 0 });
      }
    }
  }

  return {
    title: metadata.title,
    author: metadata.author.filter(Boolean).join('、'),
    chapters,
    load: async (id) => {
      const split = splits.get(id);
      if (split !== undefined) return { html: clean(split), title: '' };
      const chapter = file.loadChapter(id);
      if (!chapter) throw new Error('找不到章节');
      return { html: clean(withAnchorIds(chapter.html)), title: headingOf(chapter.html) };
    },
    destroy: () => file.destroy(),
  };
};

export const openEbook = (kind: 'epub' | 'mobi', bytes: Uint8Array) =>
  kind === 'epub' ? openEpub(bytes) : openMobi(bytes);
