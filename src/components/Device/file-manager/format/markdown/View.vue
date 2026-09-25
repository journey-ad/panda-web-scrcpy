<script setup lang="ts">
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github.css';
import MarkdownIt from 'markdown-it';
import { ref, watch } from 'vue';

import { decodeText } from '../../shared/encoding';
import { readEntry } from '../../service/readEntry';
import { useSettings } from '../../shared/settings';
import { usePreviewScope } from '../../ui/preview/usePreviewScope';
import type { FileEntry } from '../../model/types';
import EncodingMenu from '../../ui/preview/EncodingMenu.vue';
import FontSizeMenu from '../../ui/preview/FontSizeMenu.vue';

const props = defineProps<{ entry: FileEntry }>();
const emit = defineEmits<{ (e: 'error', message: string): void }>();

const { signal, done, fail } = usePreviewScope((message) => emit('error', message));

const prefs = useSettings();
/** 编码只在本次预览内有效，换文件时随组件一起重建 */
const encoding = ref<string | null>(null);
const detected = ref('');

const markdown = new MarkdownIt({
  linkify: true,
  breaks: true,
  // 无法识别语言的代码块返回空串，交给 markdown-it 自行转义
  highlight: (code, language) =>
    language && hljs.getLanguage(language) ? hljs.highlight(code, { language, ignoreIllegals: true }).value : '',
});

const html = ref('');
const progress = ref(0);

let bytes: Uint8Array | null = null;

const render = () => {
  if (!bytes) return;
  const { encoding: used, text } = decodeText(bytes, encoding.value);
  detected.value = used;
  if (done()) return;
  html.value = markdown.render(text);
};

const load = async () => {
  const { entry } = props;
  try {
    bytes = await readEntry(entry, { signal, onProgress: (value) => (progress.value = value) });
    if (done()) return;
    render();
  } catch (error) {
    fail(error);
  }
};

load();

watch(encoding, () => render());
</script>

<template>
  <!-- 字号菜单 -->
  <FontSizeMenu />
  <!-- 编码菜单 -->
  <EncodingMenu v-model="encoding" :detected="detected" />

  <div v-if="html" class="preview-markdown" :style="{ fontSize: `${prefs.textFontSize + 0.5}px` }" v-html="html" />
  <div v-else class="preview-hint">正在加载 {{ Math.round(progress * 100) }}%</div>
</template>

<style scoped>
.preview-markdown {
  align-self: stretch;
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 2px 4px;
  line-height: 1.7;
  color: rgba(24, 24, 27, 0.85);
  cursor: text;
}

.preview-markdown :deep(h1),
.preview-markdown :deep(h2),
.preview-markdown :deep(h3),
.preview-markdown :deep(h4) {
  margin: 12px 0 6px;
  font-size: 1.12em;
  font-weight: 600;
}

.preview-markdown :deep(p) {
  margin: 6px 0;
}

.preview-markdown :deep(ul),
.preview-markdown :deep(ol) {
  margin: 6px 0;
  padding-left: 20px;
}

.preview-markdown :deep(code) {
  padding: 1px 4px;
  font-size: 0.92em;
  background: rgba(24, 24, 27, 0.06);
}

.preview-markdown :deep(pre) {
  margin: 8px 0;
  padding: 8px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: rgba(24, 24, 27, 0.05);
}

.preview-markdown :deep(pre code) {
  padding: 0;
  font-size: 0.96em;
  background: none;
}

.preview-markdown :deep(blockquote) {
  margin: 6px 0;
  padding-left: 10px;
  border-left: 3px solid var(--border);
  color: var(--muted);
}

.preview-markdown :deep(table) {
  border-collapse: collapse;
}

.preview-markdown :deep(th),
.preview-markdown :deep(td) {
  padding: 3px 6px;
  border: 1px solid var(--border);
  overflow-wrap: anywhere;
}

.preview-markdown :deep(img) {
  max-width: 100%;
}
</style>
