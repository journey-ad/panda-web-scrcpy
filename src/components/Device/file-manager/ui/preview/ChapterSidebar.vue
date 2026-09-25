<script setup lang="ts">
import { ref, watch } from 'vue';

import type { OutlineItem } from '../../model/types';

const props = defineProps<{ items: OutlineItem[]; active: number }>();
const emit = defineEmits<{ (e: 'select', index: number): void }>();

const list = ref<HTMLElement | null>(null);

/** 当前章节跟着正文变化，把它保持在目录的可视区内 */
watch(
  () => props.active,
  (index) => {
    const item = list.value?.children[index] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }
);
</script>

<template>
  <aside class="chapter-sidebar">
    <div class="chapter-sidebar-head">
      <span class="chapter-sidebar-title">章节</span>
    </div>
    <ul ref="list" class="chapter-sidebar-list">
      <li
        v-for="(item, index) in items"
        :key="index"
        class="chapter-sidebar-item"
        :class="{ active: index === active }"
        :style="{ paddingLeft: `${8 + item.level * 10}px` }"
        :title="item.title"
        @click="emit('select', index)"
      >
        {{ item.title }}
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.chapter-sidebar {
  flex: 0 0 auto;
  width: 200px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  background: rgba(24, 24, 27, 0.02);
}

.chapter-sidebar-head {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.chapter-sidebar-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(24, 24, 27, 0.75);
}

.chapter-sidebar-list {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: 6px 8px;
  list-style: none;
  overflow: auto;
}

.chapter-sidebar-item {
  padding: 4px 6px 4px 0;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(24, 24, 27, 0.7);
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.chapter-sidebar-item:hover {
  background: rgba(24, 24, 27, 0.05);
}

.chapter-sidebar-item.active {
  font-weight: 500;
  color: #18181b;
  background: rgba(24, 24, 27, 0.07);
}
</style>
