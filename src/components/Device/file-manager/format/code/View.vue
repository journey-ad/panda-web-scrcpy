<script setup lang="ts">
import { mdiMagnify } from '@mdi/js';
import { computed, nextTick, ref, shallowRef, watch } from 'vue';

import { highlightLines } from '../highlight';
import { languageOf } from './index';
import { decodeText } from '../../shared/encoding';
import { readEntry } from '../../service/readEntry';
import { useSettings } from '../../shared/settings';
import { useHeadActions } from '../../ui/preview/useHeadActions';
import { usePreviewScope } from '../../ui/preview/usePreviewScope';
import type { FileEntry } from '../../model/types';
import CodeLines from '../../ui/preview/CodeLines.vue';
import EncodingMenu from '../../ui/preview/EncodingMenu.vue';
import FontSizeMenu from '../../ui/preview/FontSizeMenu.vue';
import SearchBar from '../../ui/preview/SearchBar.vue';
import Text from '../text/View.vue';

const props = defineProps<{ entry: FileEntry }>();
const emit = defineEmits<{ (e: 'error', message: string): void }>();

const { signal, loading, done, fail, stop } = usePreviewScope((message) => emit('error', message));

const prefs = useSettings();
/** 编码只在本次预览内有效，换文件时随组件一起重建 */
const encoding = ref<string | null>(null);
const detected = ref('');

/** 超过这个体积不做高亮，交回纯文本预览，走虚拟滚动 */
const HIGHLIGHT_MAX = 1024 * 1024;

/** 高亮后的每一行 */
const lines = ref<string[]>([]);
/** 文件过大，改用纯文本渲染，标题栏的按钮一并交给它 */
const plain = ref(false);
const progress = ref(0);

const language = computed(() => languageOf(props.entry.name));

/** 行高与 Text 使用同一比例，两种渲染路径才一致 */
const codeStyle = computed(() => {
  const size = prefs.textFontSize;
  return { fontSize: `${size}px`, lineHeight: `${Math.round((size * 19) / 12)}px` };
});

let bytes: Uint8Array | null = null;

const render = () => {
  if (!bytes) return;
  const { encoding: used, text: raw } = decodeText(bytes, encoding.value);
  detected.value = used;
  if (done()) return;
  lines.value = raw ? highlightLines(raw, language.value) : [];
};

const load = async () => {
  const { entry } = props;
  // 超出高亮上限直接交给纯文本预览，读取由它完成
  if (entry.size > HIGHLIGHT_MAX) {
    plain.value = true;
    return;
  }
  try {
    bytes = await readEntry(entry, { signal, onProgress: (value) => (progress.value = value) });
    if (done()) return;
    render();
  } catch (error) {
    fail(error);
  } finally {
    stop();
  }
};

load();

watch(encoding, () => render());

/* -------------------------------- 查找 -------------------------------- */

/** 输入停顿多久开始标记 */
const SEARCH_DELAY = 200;
/** 一次查找最多登记的命中数 */
const MATCH_MAX = 2000;

const headActions = useHeadActions();
const box = ref<InstanceType<typeof CodeLines> | null>(null);
const searchOn = ref(false);
const term = ref('');
/** 每条命中占一个数组，跨着色片段时会插进多个片段 */
const hits = shallowRef<HTMLElement[][]>([]);
const hitIndex = ref(0);

let searchTimer: number | null = null;

interface TextSpan {
  node: Text;
  /** 该节点首字符在整段文字里的偏移 */
  start: number;
}

/** 把每行的文字摊成一段并补回行间的换行，节点起点与这段文字对齐 */
const readText = () => {
  const spans: TextSpan[] = [];
  let text = '';
  const host = box.value?.root;
  if (!host) return { text, spans };
  const rows = host.querySelectorAll<HTMLElement>('.code-text');
  rows.forEach((row, index) => {
    if (index) text += '\n';
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const data = (node as Text).data;
      spans.push({ node: node as Text, start: text.length });
      text += data;
    }
  });
  return { text, spans };
};

/** 还原成文字节点再合并，高亮由调用方完成 */
const clearHits = () => {
  const groups = hits.value;
  hits.value = [];
  hitIndex.value = 0;
  if (!groups.length) return;
  for (const group of groups) {
    for (const mark of group) mark.replaceWith(document.createTextNode(mark.textContent ?? ''));
  }
  box.value?.root?.normalize();
};

const markCurrent = () => {
  hits.value.forEach((group, index) =>
    group.forEach((mark) => mark.classList.toggle('preview-hit-current', index === hitIndex.value))
  );
};

const showHit = (index: number) => {
  hits.value[index]?.[0]?.scrollIntoView({ block: 'center' });
};

const stepHit = (delta: number) => {
  const total = hits.value.length;
  if (!total) return;
  hitIndex.value = (hitIndex.value + delta + total) % total;
  markCurrent();
  showHit(hitIndex.value);
};

/**
 * 命中在整段文字里找，跨着色片段的组合也能算一条
 * 标记时按片段切开，一条命中可能插进多个 mark
 */
const markHits = () => {
  clearHits();
  const keyword = term.value.trim();
  if (!box.value?.root || !keyword) return;
  const { text, spans } = readText();
  if (!text || !spans.length) return;

  const needle = keyword.toLowerCase();
  const haystack = text.toLowerCase();
  const parts: { nodeIndex: number; from: number; to: number; match: number }[] = [];
  let nodeIndex = 0;
  let at = haystack.indexOf(needle);
  while (at >= 0 && hits.value.length < MATCH_MAX) {
    const end = at + needle.length;
    const match = hits.value.length;
    // 匹配是升序的，起点已经越过文字节点末尾的可以直接跳过
    while (nodeIndex < spans.length && spans[nodeIndex].start + spans[nodeIndex].node.data.length <= at) {
      nodeIndex += 1;
    }
    for (let index = nodeIndex; index < spans.length; index += 1) {
      const span = spans[index];
      if (span.start >= end) break;
      const from = Math.max(at, span.start);
      const to = Math.min(end, span.start + span.node.data.length);
      if (to > from) parts.push({ nodeIndex: index, from: from - span.start, to: to - span.start, match });
    }
    hits.value.push([]);
    at = haystack.indexOf(needle, end);
  }

  const byNode = new Map<number, typeof parts>();
  for (const part of parts) {
    const list = byNode.get(part.nodeIndex);
    if (list) list.push(part);
    else byNode.set(part.nodeIndex, [part]);
  }

  const created = hits.value;
  for (const [index, list] of byNode) {
    const node = spans[index].node;
    const source = node.data;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const part of list) {
      if (part.from > cursor) fragment.append(source.slice(cursor, part.from));
      const mark = document.createElement('mark');
      mark.className = 'preview-hit';
      mark.textContent = source.slice(part.from, part.to);
      fragment.append(mark);
      created[part.match].push(mark);
      cursor = part.to;
    }
    if (cursor < source.length) fragment.append(source.slice(cursor));
    node.replaceWith(fragment);
  }

  hitIndex.value = 0;
  markCurrent();
  showHit(0);
};

watch(term, () => {
  if (searchTimer !== null) clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    searchTimer = null;
    markHits();
  }, SEARCH_DELAY);
});

/** 切换编码会完整重新高亮，之前的命中片段随之消失，要重新标记 */
watch(lines, async () => {
  if (!term.value.trim()) return;
  await nextTick();
  markHits();
});

const toggleSearch = () => {
  searchOn.value = !searchOn.value;
  if (!searchOn.value) {
    term.value = '';
    clearHits();
  }
};
</script>

<template>
  <!-- 纯文本预览 -->
  <Text v-if="plain" :entry="entry" @error="(message) => emit('error', message)" />
  <template v-else>
    <!-- 字号菜单 -->
    <FontSizeMenu />
    <!-- 编码菜单 -->
    <EncodingMenu v-model="encoding" :detected="detected" />
    <!-- 查找 -->
    <Teleport v-if="headActions && lines.length" :to="headActions">
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

    <div class="preview-code-wrap">
      <SearchBar
        v-if="searchOn"
        v-model="term"
        :total="hits.length"
        :index="hitIndex"
        @prev="stepHit(-1)"
        @next="stepHit(1)"
        @close="toggleSearch"
      />
      <CodeLines v-if="lines.length" ref="box" :style="codeStyle" :lines="lines" />
      <div v-else class="preview-hint">
        {{ loading ? `正在加载 ${Math.round(progress * 100)}%` : '文件为空' }}
      </div>
    </div>
  </template>
</template>

<style scoped>
.preview-code-wrap {
  align-self: stretch;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.preview-code-wrap .preview-hint {
  margin: auto;
}
</style>
