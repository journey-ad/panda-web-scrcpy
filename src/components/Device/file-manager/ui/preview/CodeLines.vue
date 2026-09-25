<script setup lang="ts">
import 'highlight.js/styles/github.css';
import { ref } from 'vue';

/** 高亮后的每一行，行内的标签已经闭合 */
defineProps<{ lines: string[] }>();

/** 查找要在这棵渲染树上定位命中，根元素交给调用方 */
const root = ref<HTMLElement | null>(null);
defineExpose({ root });
</script>

<template>
  <div ref="root" class="code-lines hljs">
    <div v-for="(line, index) in lines" :key="index" class="code-line">
      <span class="code-text" v-html="line" />
    </div>
  </div>
</template>

<style scoped>
.code-lines {
  counter-reset: code-line;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  padding: 2px 4px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 19px;
  tab-size: 4;
  cursor: text;
}

.code-line {
  display: flex;
  align-items: flex-start;
  counter-increment: code-line;
}

.code-line::before {
  content: counter(code-line);
  flex: 0 0 auto;
  width: 4em;
  padding-right: 10px;
  text-align: right;
  color: var(--muted);
  user-select: none;
}

.code-text {
  flex: 1 1 auto;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.code-lines :deep(mark.preview-hit) {
  background: rgba(250, 204, 21, 0.45);
  color: inherit;
}

.code-lines :deep(mark.preview-hit-current) {
  background: rgba(249, 115, 22, 0.55);
}
</style>
