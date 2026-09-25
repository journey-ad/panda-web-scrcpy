<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';

import { mdiMagnify } from '@mdi/js';

import { findChapters, type Chapter } from '../../shared/outline';
import { decodeText } from '../../shared/encoding';
import { readEntry } from '../../service/readEntry';
import { useSettings } from '../../shared/settings';
import { useHeadActions } from '../../ui/preview/useHeadActions';
import { usePreviewScope } from '../../ui/preview/usePreviewScope';
import type { FileEntry, OutlineItem } from '../../model/types';
import ChapterSidebar from '../../ui/preview/ChapterSidebar.vue';
import EncodingMenu from '../../ui/preview/EncodingMenu.vue';
import FontSizeMenu from '../../ui/preview/FontSizeMenu.vue';
import OutlineToggle from '../../ui/preview/OutlineToggle.vue';
import SearchBar from '../../ui/preview/SearchBar.vue';

const props = defineProps<{ entry: FileEntry }>();
const emit = defineEmits<{ (e: 'error', message: string): void }>();
/** 编码只在本次预览内有效，换文件时随组件一起重建 */
const encoding = ref<string | null>(null);
const detected = ref('');
const outlineOn = ref(true);

const { signal, loading, done, fail, stop } = usePreviewScope((message) => emit('error', message));

/** 行高与字号的固定比，改字号时行高按同比例变化，虚拟滚动才不会错位 */
const LINE_RATIO = 19 / 12;
/** 分片处理的粒度，每片处理完让出主线程 */
const SLICE_CHARS = 1 << 20;
/** 单行超过这个长度就拆成多行，每行都是独立的文本节点 */
const MAX_ROW_CHARS = 4000;
/** 视口上下各多渲染几行 */
const OVERSCAN = 24;
/** 预览用的等宽字体，测量字宽与渲染用同一套字体 */
const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';
/** 制表符按 8 个空格宽计算，与浏览器的默认 tab-size 一致 */
const TAB_SIZE = 8;
/** 宽度变化后延迟重排，连续改变窗口大小时只重排一次 */
const REWRAP_DELAY = 150;
/** JSON 显示行号，行号栏的宽度按字号换算 */
const GUTTER_RATIO = 4;

const prefs = useSettings();
const fontSize = computed(() => prefs.textFontSize);
const lineHeight = computed(() => Math.round(fontSize.value * LINE_RATIO));
const showNumbers = computed(() => props.entry.preview === 'json');
const gutter = computed(() => (showNumbers.value ? Math.round(fontSize.value * GUTTER_RATIO) : 0));

const host = ref<HTMLElement | null>(null);
const text = shallowRef('');
/** 每行的 [起点, 终点) 成对存放，只存整数就不会为几十万行各建一个字符串 */
const bounds = shallowRef(new Int32Array(0));
/** 每行对应的行号，折行块的首行标号，继续行记 0；只有 JSON 显示 */
const rowNumbers = shallowRef(new Int32Array(0));
const rowCount = ref(0);
const firstRow = ref(0);
const viewportRows = ref(40);
const progress = ref(0);
/** 当前断行所用的宽度与字号，两者变化后重新断行 */
const wrapKey = ref('');
/** 建立当前行索引时所用的行高，换字号后滚动位置要按旧值换算 */
let wrapLineHeight = lineHeight.value;
/** 识别到的章节，只有纯文本按章节标记识别 */
const chapters = shallowRef<Chapter[]>([]);
/** 当前章节在目录里的下标，-1 表示视口还没进入任何章节 */
const activeChapter = ref(-1);

let observer: ResizeObserver | null = null;
let rewrapTimer: number | null = null;

const yieldToHost = () => new Promise((resolve) => setTimeout(resolve, 0));

const gauge = document.createElement('canvas').getContext('2d');
/** 每个码位在等宽字体下的渲染宽度，按码位缓存 */
const charWidths = new Map<number, number>();

/** 单个码位的渲染宽度；宽度为 0 的码位不会把行断开 */
const charWidth = (code: number) => {
  const cached = charWidths.get(code);
  if (cached !== undefined) return cached;
  if (!gauge) return 0;
  gauge.font = `${fontSize.value}px ${MONO_FONT}`;
  const width = gauge.measureText(String.fromCodePoint(code)).width;
  charWidths.set(code, width);
  return width;
};

let scrollbar = -1;

/** 系统竖向滚动条的宽度 */
const scrollbarWidth = () => {
  if (scrollbar >= 0) return scrollbar;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll';
  document.body.append(probe);
  scrollbar = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return scrollbar;
};

/** 外层排版给的字距，canvas 量宽不含这一项，按码位数单独累加 */
const spacingWidth = () => {
  const value = host.value ? Number.parseFloat(getComputedStyle(host.value).letterSpacing) : 0;
  return Number.isFinite(value) ? value : 0;
};

/** 排版宽度：预览区的内容宽度，行数还不足时先扣掉将要出现的竖向滚动条 */
const contentWidth = () => {
  const box = host.value;
  if (!box) return 0;
  // clientWidth 含左右内边距，断行要按正文可用宽度算，行号栏占的宽度也要扣掉
  const style = getComputedStyle(box);
  const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const scrollable = box.scrollHeight > box.clientHeight;
  return Math.max(0, box.clientWidth - padding - gutter.value - (scrollable ? 0 : scrollbarWidth()));
};

/** 断行依据：宽度或字号任一变化都要重排 */
const keyOf = (capacity: number) => `${capacity}@${fontSize.value}`;

/**
 * JSON 缩进器：只扫描字符不建对象，超大 JSON 也不会因 JSON.parse/stringify 耗尽内存
 * 一并识别 JSON5 的两种注释
 */
const createJsonFormatter = () => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let pendingStar = false;
  let newline = false;
  let last = '';

  return (part: string) => {
    let out = '';
    for (let index = 0; index < part.length; index += 1) {
      const char = part[index];

      if (lineComment) {
        out += char;
        if (char === '\n') {
          lineComment = false;
          newline = true;
        }
        continue;
      }
      if (blockComment) {
        out += char;
        if (pendingStar && char === '/') blockComment = false;
        pendingStar = char === '*';
        continue;
      }
      if (inString) {
        out += char;
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') continue;
      if (char === '/' && part[index + 1] === '/') {
        lineComment = true;
        out += '//';
        index += 1;
        last = '/';
        continue;
      }
      if (char === '/' && part[index + 1] === '*') {
        blockComment = true;
        pendingStar = false;
        out += '/*';
        index += 1;
        last = '/';
        continue;
      }

      // 闭合括号与逗号都紧跟在上一段内容后面，不另起一行
      if (newline && char !== '}' && char !== ']' && char !== ',') out += `\n${'  '.repeat(depth)}`;
      newline = false;

      if (char === '"') {
        inString = true;
      } else if (char === '{' || char === '[') {
        depth += 1;
        newline = true;
      } else if (char === '}' || char === ']') {
        depth = Math.max(0, depth - 1);
        // 空容器不占一行
        if (last !== '{' && last !== '[') out += `\n${'  '.repeat(depth)}`;
        newline = true;
      } else if (char === ',') {
        newline = true;
      } else if (char === ':') {
        out += ': ';
        last = ':';
        continue;
      }

      out += char;
      last = char;
    }
    return out;
  };
};

/** 逐片格式化，片与片之间让出主线程，处理期间界面不会失去响应 */
const formatJson = async (raw: string) => {
  const formatter = createJsonFormatter();
  const parts: string[] = [];
  for (let start = 0; start < raw.length; start += SLICE_CHARS) {
    parts.push(formatter(raw.slice(start, start + SLICE_CHARS)));
    await yieldToHost();
    if (done()) return raw;
  }
  return parts.join('');
};

/** 逐片扫描换行得到行区间；一行超过可用宽度就在字符之间断开，内容不丢失 */
const buildRows = async (value: string, capacity: number) => {
  const rows: number[] = [];
  const numbers: number[] = [];
  const limit = capacity > 0 ? capacity : Infinity;
  const spacing = spacingWidth();
  const tab = charWidth(32) * TAB_SIZE;
  let rowStart = 0;
  let rowWidth = 0;
  let line = 1;
  /** 当前渲染行的标号，折行出来的继续行记 0 */
  let mark = line;

  for (let start = 0; start < value.length; start += SLICE_CHARS) {
    const end = Math.min(start + SLICE_CHARS, value.length);
    for (let index = start; index < end; index += 1) {
      const code = value.charCodeAt(index);
      if (code === 10) {
        rows.push(rowStart, index);
        numbers.push(mark);
        line += 1;
        mark = line;
        rowStart = index + 1;
        rowWidth = 0;
        continue;
      }
      const width = (code === 9 ? tab : charWidth(code)) + spacing;
      // 每行至少留一个码位，宽度为 0 的码位单独成行时也不会空断
      if (index > rowStart && (rowWidth + width > limit || index - rowStart >= MAX_ROW_CHARS)) {
        rows.push(rowStart, index);
        numbers.push(mark);
        mark = 0;
        rowStart = index;
        rowWidth = 0;
      }
      rowWidth += width;
    }
    await yieldToHost();
    if (done()) break;
  }

  if (!rows.length) {
    rows.push(0, 0);
    numbers.push(mark);
  } else if (rowStart < value.length) {
    rows.push(rowStart, value.length);
    numbers.push(mark);
  }
  return { bounds: Int32Array.from(rows), numbers: Int32Array.from(numbers) };
};

/** 原始字节保留在内存中，换编码时直接复用 */
let bytes: Uint8Array | null = null;

interface JsonSpan {
  text: string;
  cls: string;
}

/** JSON 单行着色：按行拆分，后跟冒号的字符串按属性名着色，与值区分开 */
const JSON_TOKEN =
  /("(?:\\u[0-9a-fA-F]{4}|\\.|[^\\"])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;

const tokenizeJson = (line: string) => {
  const spans: JsonSpan[] = [];
  let last = 0;
  JSON_TOKEN.lastIndex = 0;
  for (let match = JSON_TOKEN.exec(line); match; match = JSON_TOKEN.exec(line)) {
    if (match.index > last) spans.push({ text: line.slice(last, match.index), cls: '' });
    if (match[1] !== undefined) {
      spans.push({ text: match[1], cls: match[2] ? 'jt-key' : 'jt-str' });
      if (match[2]) spans.push({ text: match[2], cls: 'jt-punct' });
    } else if (match[3] !== undefined) {
      spans.push({ text: match[3], cls: 'jt-num' });
    } else if (match[4] !== undefined) {
      spans.push({ text: match[4], cls: 'jt-lit' });
    } else {
      spans.push({ text: match[5], cls: 'jt-punct' });
    }
    last = match.index + match[0].length;
  }
  if (last < line.length) spans.push({ text: line.slice(last), cls: '' });
  return spans;
};

/** 只有 JSON 需要着色；按行号缓存，滚动时只拆分新进入视口的行 */
const highlightJson = computed(() => props.entry.preview === 'json');
const spans = new Map<number, JsonSpan[]>();

const cachedSpans = (index: number, line: string) => {
  const cached = spans.get(index);
  if (cached) return cached;
  const created = tokenizeJson(line);
  spans.set(index, created);
  return created;
};

/** 解码 → 可选格式化 → 建行索引，换编码时整条链路重新执行 */
const render = async () => {
  if (!bytes) return;
  loading.value = true;
  try {
    const { encoding: used, text: raw } = decodeText(bytes, encoding.value);
    detected.value = used;
    if (done()) return;
    const value = props.entry.preview === 'json' ? await formatJson(raw) : raw;
    if (done()) return;
    text.value = value;
    chapters.value = props.entry.preview === 'text' ? findChapters(value) : [];
    const capacity = contentWidth();
    wrapKey.value = keyOf(capacity);
    wrapLineHeight = lineHeight.value;
    const rows = await buildRows(value, capacity);
    if (done()) return;
    bounds.value = rows.bounds;
    rowNumbers.value = rows.numbers;
    rowCount.value = bounds.value.length / 2;
    spans.clear();
    firstRow.value = 0;
    await nextTick();
    if (host.value) host.value.scrollTop = 0;
    measure();
  } catch (error) {
    fail(error);
  } finally {
    stop();
  }
};

const load = async () => {
  const { entry } = props;
  try {
    bytes = await readEntry(entry, { signal, onProgress: (value) => (progress.value = value) });
    if (done()) return;
    await render();
  } catch (error) {
    fail(error);
    stop();
  }
};

/* -------------------------------- 查找 -------------------------------- */

/** 一次查找最多登记的命中数，超出后停止往下扫描 */
const MATCH_MAX = 2000;
/** 输入停顿多久开始扫全文 */
const SEARCH_DELAY = 150;

const headActions = useHeadActions();
const searchOn = ref(false);
const term = ref('');
/** 命中的字符偏移，断行后仍然有效 */
const matches = shallowRef<number[]>([]);
const matchIndex = ref(0);

let searchTimer: number | null = null;

const scan = () => {
  const keyword = term.value.trim();
  matches.value = [];
  matchIndex.value = 0;
  if (!keyword) return;
  const haystack = text.value.toLowerCase();
  const needle = keyword.toLowerCase();
  const found: number[] = [];
  let at = haystack.indexOf(needle);
  while (at >= 0 && found.length < MATCH_MAX) {
    found.push(at);
    at = haystack.indexOf(needle, at + needle.length);
  }
  matches.value = found;
  if (found.length) nextTick(() => showMatch(0));
};

watch(term, () => {
  if (searchTimer !== null) clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    searchTimer = null;
    scan();
  }, SEARCH_DELAY);
});

/** 跳到某一条命中，行号按偏移现算，换字号重排后也成立 */
const showMatch = (index: number) => {
  const offset = matches.value[index];
  const box = host.value;
  if (offset === undefined || !box) return;
  const line = lineHeight.value;
  const top = rowOfOffset(offset) * line;
  const visible = box.scrollTop + box.clientHeight - line * 3;
  if (top < box.scrollTop || top > visible) {
    box.scrollTop = Math.max(0, top - Math.round(box.clientHeight / line / 3) * line);
  }
  onScroll();
};

const stepMatch = (delta: number) => {
  const total = matches.value.length;
  if (!total) return;
  matchIndex.value = (matchIndex.value + delta + total) % total;
  showMatch(matchIndex.value);
};

const toggleSearch = () => {
  searchOn.value = !searchOn.value;
  if (!searchOn.value) {
    term.value = '';
    matches.value = [];
  }
};

/** 落在 [from, to) 里的命中，返回相对 from 的区间 */
const hitsIn = (from: number, to: number, length: number) => {
  const list = matches.value;
  const result: [number, number][] = [];
  if (!list.length) return result;
  let low = 0;
  let high = list.length - 1;
  let first = list.length;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (list[middle] >= from) {
      first = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  // 起点在 from 之前的那条仍可能跨进来
  for (let i = Math.max(0, first - 1); i < list.length && list[i] < to; i += 1) {
    const start = Math.max(list[i], from);
    const end = Math.min(list[i] + length, to);
    if (end > start) result.push([start - from, end - from]);
  }
  return result;
};

interface Segment {
  text: string;
  cls: string;
  hit: boolean;
  /** 当前停留的那一条命中 */
  current: boolean;
}

/** 一行按 JSON 着色与查找命中切成片段，命中跨片段时各片段各自切断 */
const segmentsOf = (index: number, line: string, start: number): Segment[] => {
  let spans: JsonSpan[] = [{ text: line, cls: '' }];
  if (highlightJson.value) {
    spans = cachedSpans(index, line);
  }
  const keyword = term.value.trim();
  const current = matches.value[matchIndex.value];
  const out: Segment[] = [];
  let cursor = start;
  for (const span of spans) {
    const spanStart = cursor;
    cursor += span.text.length;
    if (!keyword) {
      out.push({ ...span, hit: false, current: false });
      continue;
    }
    const hits = hitsIn(spanStart, cursor, keyword.length);
    if (!hits.length) {
      out.push({ ...span, hit: false, current: false });
      continue;
    }
    let last = 0;
    for (const [from, to] of hits) {
      if (from > last) out.push({ text: span.text.slice(last, from), cls: span.cls, hit: false, current: false });
      out.push({
        text: span.text.slice(from, to),
        cls: span.cls,
        hit: true,
        current: current !== undefined && spanStart + from === current,
      });
      last = to;
    }
    if (last < span.text.length) {
      out.push({ text: span.text.slice(last), cls: span.cls, hit: false, current: false });
    }
  }
  return out;
};

const rowTop = computed(() => Math.min(firstRow.value, Math.max(0, rowCount.value - 1)));

const windowRows = computed(() => {
  const store = bounds.value;
  const from = rowTop.value;
  const to = Math.min(rowCount.value, from + viewportRows.value);
  const value = text.value;
  const list: { key: number; line: number; segments: Segment[] }[] = [];
  for (let index = from; index < to; index += 1) {
    const start = store[index * 2];
    list.push({
      key: index,
      line: rowNumbers.value[index] ?? 0,
      segments: segmentsOf(index, value.slice(start, store[index * 2 + 1]), start),
    });
  }
  return list;
});

const topPad = computed(() => rowTop.value * lineHeight.value);
const bottomPad = computed(() =>
  Math.max(0, (rowCount.value - rowTop.value - windowRows.value.length) * lineHeight.value)
);

/** 字符偏移落在哪一行，行区间按起点有序，二分即可 */
const rowOfOffset = (offset: number) => {
  const store = bounds.value;
  let low = 0;
  let high = store.length / 2 - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (store[middle * 2] <= offset) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
};

/** 章节标题的行号，断行宽度变化后按偏移重新换算 */
const chapterRows = computed(() => chapters.value.map((item) => rowOfOffset(item.offset)));

const outlineItems = computed<OutlineItem[]>(() => chapters.value.map((item) => ({ title: item.title, level: 0 })));

const showOutline = computed(() => outlineOn.value && chapters.value.length > 0);

/** 视口顶端的行号落在哪个章节里 */
const syncActiveChapter = (topRow: number) => {
  const rows = chapterRows.value;
  let low = 0;
  let high = rows.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (rows[middle] <= topRow) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  activeChapter.value = found;
};

const jumpToChapter = (index: number) => {
  const row = chapterRows.value[index];
  const box = host.value;
  if (row === undefined || !box) return;
  box.scrollTop = row * lineHeight.value;
  onScroll();
};

const measure = () => {
  if (!host.value) return;
  viewportRows.value = Math.ceil(host.value.clientHeight / lineHeight.value) + OVERSCAN * 2;
  onScroll();
  if (keyOf(contentWidth()) !== wrapKey.value) scheduleRewrap();
};

const scheduleRewrap = () => {
  if (rewrapTimer !== null) clearTimeout(rewrapTimer);
  rewrapTimer = window.setTimeout(() => {
    rewrapTimer = null;
    void rewrap();
  }, REWRAP_DELAY);
};

/** 重排前记下视口顶端所在的字符偏移，重排后回到同一处内容 */
const anchorOffset = () => {
  const box = host.value;
  const store = bounds.value;
  if (!box || !store.length) return 0;
  const row = Math.min(Math.floor(box.scrollTop / wrapLineHeight), store.length / 2 - 1);
  return store[Math.max(0, row) * 2];
};

/** 宽度或字号变化后按新值重新断行，视口顶端的内容保持在原处 */
const rewrap = async () => {
  const capacity = contentWidth();
  const key = keyOf(capacity);
  if (done() || !text.value || key === wrapKey.value) return;
  const anchor = anchorOffset();
  wrapKey.value = key;
  wrapLineHeight = lineHeight.value;
  const rows = await buildRows(text.value, capacity);
  if (done()) return;
  bounds.value = rows.bounds;
  rowNumbers.value = rows.numbers;
  rowCount.value = bounds.value.length / 2;
  spans.clear();
  await nextTick();
  if (done() || !host.value) return;
  const row = Math.min(rowOfOffset(anchor), Math.max(0, rowCount.value - 1));
  firstRow.value = Math.max(0, row - OVERSCAN);
  host.value.scrollTop = row * lineHeight.value;
  measure();
};

const onScroll = () => {
  if (!host.value) return;
  const top = Math.max(0, Math.floor(host.value.scrollTop / lineHeight.value));
  firstRow.value = Math.max(0, top - OVERSCAN);
  if (chapters.value.length) syncActiveChapter(top);
};

const loadingHint = computed(() =>
  progress.value >= 1 ? '正在处理长文本…' : `正在加载 ${Math.round(progress.value * 100)}%`
);

/** 字号变了行高跟着变，可渲染行数与滚动位置都要重算 */
const hostStyle = computed(() => ({
  '--text-size': `${fontSize.value}px`,
  '--text-line-height': `${lineHeight.value}px`,
  '--text-gutter': `${gutter.value}px`,
}));

watch(encoding, () => void render());

watch(fontSize, async () => {
  charWidths.clear();
  await nextTick();
  void rewrap();
});

onMounted(() => {
  observer = new ResizeObserver(measure);
  if (host.value) observer.observe(host.value);
  void load();
});

onUnmounted(() => {
  if (rewrapTimer !== null) clearTimeout(rewrapTimer);
  observer?.disconnect();
  observer = null;
});
</script>

<template>
  <!-- 字号菜单 -->
  <FontSizeMenu />
  <!-- 编码菜单 -->
  <EncodingMenu v-model="encoding" :detected="detected" />
  <!-- 目录开关 -->
  <OutlineToggle v-if="chapters.length" v-model="outlineOn" />
  <!-- 查找 -->
  <Teleport v-if="headActions && text" :to="headActions">
    <v-btn
      class="preview-head-action"
      icon
      size="small"
      variant="text"
      title="查找"
      @click="toggleSearch"
    >
      <v-icon size="18" :icon="mdiMagnify" />
    </v-btn>
  </Teleport>

  <div class="preview-text-wrap" :style="hostStyle">
    <SearchBar
      v-if="searchOn"
      v-model="term"
      :total="matches.length"
      :index="matchIndex"
      @prev="stepMatch(-1)"
      @next="stepMatch(1)"
      @close="toggleSearch"
    />
    <div class="preview-text-stage">
      <!-- 章节列表 -->
      <ChapterSidebar v-if="showOutline" :items="outlineItems" :active="activeChapter" @select="jumpToChapter" />
      <div ref="host" class="preview-text" @scroll="onScroll">
        <template v-if="text">
          <div class="preview-text-spacer" :style="{ height: `${topPad}px` }" />
          <div v-for="row in windowRows" :key="row.key" class="preview-text-row">
            <span v-if="showNumbers && row.line" class="preview-text-no">{{ row.line }}</span>
            <span
              v-for="(segment, index) in row.segments"
              :key="index"
              :class="[segment.cls, { 'preview-hit': segment.hit, 'preview-hit-current': segment.current }]"
              >{{ segment.text }}</span
            >
          </div>
          <div class="preview-text-spacer" :style="{ height: `${bottomPad}px` }" />
        </template>
      </div>
    </div>
    <div v-if="!text" class="preview-hint">{{ loading ? loadingHint : '文件为空' }}</div>
  </div>
</template>

<style scoped>
.preview-text-wrap {
  align-self: stretch;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.preview-text-stage {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}

.preview-text {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  padding: 8px 14px 32px 16px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--text-size, 12px);
  line-height: var(--text-line-height, 19px);
  cursor: text;
}

.preview-text-row {
  position: relative;
  height: var(--text-line-height, 19px);
  padding-left: var(--text-gutter, 48px);
  white-space: pre;
}

.preview-text-no {
  position: absolute;
  left: 0;
  width: calc(var(--text-gutter, 48px) - 10px);
  text-align: right;
  color: var(--muted);
  user-select: none;
}

.preview-text-spacer {
  width: 1px;
}

.preview-hit {
  background: rgba(250, 204, 21, 0.45);
}

.preview-hit-current {
  background: rgba(249, 115, 22, 0.55);
}

.jt-key,
.jt-num,
.jt-lit {
  color: #005cc5;
}

.jt-str {
  color: #032f62;
}

.jt-punct {
  color: #6a737d;
}
</style>
