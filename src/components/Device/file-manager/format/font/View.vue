<script setup lang="ts">
import { onUnmounted, ref, useId } from 'vue';

import { analyzeFont, type FontInfo } from './parser';
import { readEntry } from '../../service/readEntry';
import { usePreviewScope } from '../../ui/preview/usePreviewScope';
import type { FileEntry } from '../../model/types';

const props = defineProps<{ entry: FileEntry }>();
const emit = defineEmits<{ (e: 'error', message: string): void }>();

const { signal, loading, done, fail, stop } = usePreviewScope((message) => emit('error', message));

const SIZES = [8, 12, 16, 24, 32, 48, 60, 72];
/** 中文样张选用笔画结构齐全的句子，「永」字覆盖八法 */
const DEFAULT_SAMPLE = '天地玄黄，宇宙洪荒。永字八法，汉字之美。';
const GLYPHS = [
  'The quick brown fox jumps over the lazy dog',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789 .,;:!?@#$%&*()[]{}+-=/<>~ "\'',
].join('\n');

/** 每个实例注册独立的 family，与系统字体和上一次预览区分 */
const family = `fm-font-${useId()}`;

/** tsconfig 的 lib 没带 dom.iterable，FontFaceSet 的增删在这里补上类型 */
type FontSet = FontFaceSet & { add(face: FontFace): void; delete(face: FontFace): void };
const fontSet = document.fonts as FontSet;

const info = ref<FontInfo | null>(null);
const sample = ref(DEFAULT_SAMPLE);
const ready = ref(false);
const progress = ref(0);

let objectUrl = '';
let loaded: FontFace | null = null;

const load = async () => {
  const { entry } = props;
  try {
    const data = await readEntry(entry, { signal, onProgress: (value) => (progress.value = value) });
    if (done()) return;
    info.value = await analyzeFont(data).catch(() => null);
    if (done()) return;

    objectUrl = URL.createObjectURL(new Blob([data as BlobPart]));
    loaded = new FontFace(family, `url(${objectUrl})`);
    await loaded.load();
    if (done()) return;
    fontSet.add(loaded);
    ready.value = true;
  } catch (error) {
    fail(error);
  } finally {
    stop();
  }
};

load();

onUnmounted(() => {
  if (loaded) fontSet.delete(loaded);
  if (objectUrl) URL.revokeObjectURL(objectUrl);
});
</script>

<template>
  <div class="preview-font">
    <div v-if="info" class="font-head">
      <div class="font-family">{{ info.family || entry.name }}</div>
      <div class="font-meta">
        <span>{{ info.format }}</span>
        <template v-if="info.subfamily">
          <span class="font-dot">·</span>
          <span>{{ info.subfamily }}</span>
        </template>
        <template v-if="info.version">
          <span class="font-dot">·</span>
          <span>{{ info.version }}</span>
        </template>
        <template v-if="info.glyphs">
          <span class="font-dot">·</span>
          <span>{{ info.glyphs }} 字形</span>
        </template>
        <template v-if="info.tables">
          <span class="font-dot">·</span>
          <span>{{ info.tables }} 张表</span>
        </template>
      </div>
      <div v-if="info.note" class="font-note">{{ info.note }}</div>
    </div>

    <div v-if="!ready" class="preview-hint">
      {{ loading ? `正在加载 ${Math.round(progress * 100)}%` : '该字体无法渲染' }}
    </div>

    <template v-else>
      <input v-model="sample" class="font-input" :style="{ fontFamily: family }" placeholder="样例文本" />
      <div class="font-samples">
        <div
          v-for="size in SIZES"
          :key="size"
          class="font-line"
          :style="{ fontFamily: family, fontSize: `${size}px` }"
        >
          {{ sample }}
        </div>
      </div>
      <div class="font-glyphs" :style="{ fontFamily: family }">{{ GLYPHS }}</div>
    </template>
  </div>
</template>

<style scoped>
.preview-font {
  align-self: stretch;
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 2px 4px;
  font-size: 12px;
  color: rgba(24, 24, 27, 0.85);
}

.font-head {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.font-family {
  font-size: 14px;
  font-weight: 500;
}

.font-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
  font-size: 11px;
  color: var(--muted);
}

.font-dot {
  opacity: 0.5;
}

.font-note {
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted);
}

.font-input {
  width: 100%;
  margin: 8px 0;
  padding: 4px 6px;
  border: 1px solid var(--border);
  background: none;
  color: inherit;
  outline: none;
}

.font-input:focus {
  border-color: var(--border-hover);
}

.font-samples {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0 10px;
  overflow: hidden;
}

.font-line {
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
}

.font-glyphs {
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-size: 15px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--muted);
}
</style>