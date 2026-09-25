<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef } from 'vue';

import { openEbook, type Ebook, type EbookChapter } from './parser';
import { readEntry } from '../../service/readEntry';
import { usePreviewScope } from '../../ui/preview/usePreviewScope';
import type { FileEntry, OutlineItem } from '../../model/types';
import ChapterSidebar from '../../ui/preview/ChapterSidebar.vue';
import OutlineToggle from '../../ui/preview/OutlineToggle.vue';

const props = defineProps<{ entry: FileEntry }>();
const emit = defineEmits<{ (e: 'error', message: string): void }>();

const outlineOn = ref(true);

const { signal, loading, done, fail, stop } = usePreviewScope((message) => emit('error', message));

const host = ref<HTMLElement | null>(null);
const book = shallowRef<Ebook | null>(null);
const chapters = ref<EbookChapter[]>([]);
/** 书内目录缺条目名时，用载入到的正文标题补上 */
const titles = ref(new Map<string, string>());
const index = ref(0);
/** 正文，由解析库清掉脚本与事件 */
const html = ref('');
const progress = ref(0);


const outlineItems = computed<OutlineItem[]>(() =>
  chapters.value.map((item, position) => ({
    title: item.title || titles.value.get(item.id) || `第 ${position + 1} 节`,
    level: item.level,
  }))
);

const showOutline = computed(() => outlineOn.value && chapters.value.length > 0);

const loadingHint = computed(() =>
  progress.value >= 1 ? '正在解析…' : `正在加载 ${Math.round(progress.value * 100)}%`
);

/** 切章后回到章节开头，章节内带锚点时定位到锚点 */
const seek = (anchor: string) => {
  const box = host.value;
  if (!box) return;
  box.scrollTop = 0;
  if (!anchor) return;
  let target: Element | null = null;
  try {
    target = box.querySelector(anchor);
  } catch {
    /* 锚点选择器来自书内目录，无法定位时按章节开头展示 */
  }
  if (!target) return;
  box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top;
};

const select = async (position: number) => {
  const current = book.value;
  const chapter = chapters.value[position];
  if (!current || !chapter) return;
  if (position === index.value && html.value) return;
  index.value = position;
  try {
    const content = await current.load(chapter.id);
    if (done() || index.value !== position) return;
    html.value = content.html;
    if (content.title && !chapter.title) titles.value.set(chapter.id, content.title);
    await nextTick();
    if (done()) return;
    seek(chapter.anchor);
  } catch (error) {
    fail(error);
  }
};

onMounted(async () => {
  try {
    const bytes = await readEntry(props.entry, { signal, onProgress: (value) => (progress.value = value) });
    if (done()) return;
    const parsed = await openEbook(props.entry.preview as 'epub' | 'mobi', bytes);
    if (done()) {
      parsed.destroy();
      return;
    }
    book.value = parsed;
    chapters.value = parsed.chapters;
    if (parsed.chapters.length) await select(0);
  } catch (error) {
    fail(error);
  } finally {
    stop();
  }
});

onUnmounted(() => {
  book.value?.destroy();
  book.value = null;
});
</script>

<template>
  <!-- 目录开关 -->
  <OutlineToggle v-if="chapters.length" v-model="outlineOn" />

  <div class="preview-ebook-wrap">
    <div class="preview-ebook-stage">
      <!-- 章节列表 -->
      <ChapterSidebar v-if="showOutline" :items="outlineItems" :active="index" @select="select" />
      <div ref="host" class="preview-ebook">
        <div v-if="html" class="preview-ebook-body" v-html="html" />
      </div>
    </div>
    <div v-if="!html" class="preview-hint">{{ loading ? loadingHint : '没有可显示的正文' }}</div>
  </div>
</template>

<style scoped>
.preview-ebook-wrap {
  align-self: stretch;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.preview-ebook-stage {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}

.preview-ebook {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  padding-bottom: 24px;
  overflow: auto;
}

.preview-ebook-body {
  max-width: 720px;
  margin: 0 auto;
  font-size: 16px;
  line-height: 1.8;
  color: rgba(24, 24, 27, 0.85);
  overflow-wrap: break-word;
}

.preview-ebook-body :deep(p) {
  margin: 0 0 0.9em;
}

.preview-ebook-body :deep(h1),
.preview-ebook-body :deep(h2),
.preview-ebook-body :deep(h3),
.preview-ebook-body :deep(h4),
.preview-ebook-body :deep(h5),
.preview-ebook-body :deep(h6) {
  margin: 1.4em 0 0.6em;
  font-size: 1.3em;
  font-weight: 600;
  line-height: 1.45;
  color: #18181b;
}

.preview-ebook-body :deep(h3),
.preview-ebook-body :deep(h4),
.preview-ebook-body :deep(h5),
.preview-ebook-body :deep(h6) {
  font-size: 1.1em;
}

.preview-ebook-body :deep(img),
.preview-ebook-body :deep(svg) {
  max-width: 100%;
  height: auto;
}

.preview-ebook-body :deep(blockquote) {
  margin: 1em 0;
  padding: 2px 0 2px 12px;
  border-left: 3px solid var(--border);
  color: rgba(24, 24, 27, 0.62);
}

.preview-ebook-body :deep(pre) {
  padding: 8px 10px;
  border-radius: 4px;
  background: rgba(24, 24, 27, 0.04);
  font-size: 0.9em;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.preview-ebook-body :deep(table) {
  max-width: 100%;
  border-collapse: collapse;
}

.preview-ebook-body :deep(th),
.preview-ebook-body :deep(td) {
  padding: 2px 8px;
  border: 1px solid var(--border);
  overflow-wrap: anywhere;
}

.preview-ebook-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
}

.preview-ebook-body :deep(a) {
  color: #1a73e8;
  text-decoration: none;
}
</style>
