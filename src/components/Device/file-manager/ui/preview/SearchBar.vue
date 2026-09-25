<script setup lang="ts">
import { mdiChevronDown, mdiChevronUp, mdiClose } from '@mdi/js';
import { computed, onMounted, ref } from 'vue';

const term = defineModel<string>({ required: true });
const props = defineProps<{ total: number; index: number }>();
const emit = defineEmits<{ (e: 'prev'): void; (e: 'next'): void; (e: 'close'): void }>();

const field = ref<HTMLInputElement | null>(null);

const state = computed(() => (props.total ? `${props.index + 1} / ${props.total}` : '无匹配'));

/** 回车往下找，按住 shift 往回找 */
const onEnter = (event: KeyboardEvent) => {
  if (!props.total) return;
  if (event.shiftKey) emit('prev');
  else emit('next');
};

onMounted(() => field.value?.focus());
</script>

<template>
  <div class="preview-search">
    <input
      ref="field"
      v-model="term"
      class="preview-search-input"
      placeholder="在当前文件里查找"
      spellcheck="false"
      autocomplete="off"
      @keydown.enter="onEnter"
      @keydown.esc="emit('close')"
    />
    <span class="preview-search-state">{{ state }}</span>
    <v-btn
      icon
      variant="text"
      size="x-small"
      title="上一个"
      :disabled="!total"
      @click="emit('prev')"
    >
      <v-icon size="16" :icon="mdiChevronUp" />
    </v-btn>
    <v-btn
      icon
      variant="text"
      size="x-small"
      title="下一个"
      :disabled="!total"
      @click="emit('next')"
    >
      <v-icon size="16" :icon="mdiChevronDown" />
    </v-btn>
    <v-btn icon variant="text" size="x-small" title="关闭查找" @click="emit('close')">
      <v-icon size="16" :icon="mdiClose" />
    </v-btn>
  </div>
</template>

<style scoped>
.preview-search {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 4px 0 8px;
  border-bottom: 1px solid var(--border);
}

.preview-search-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 32px;
  padding: 0 4px;
  border: none;
  background: none;
  font-family: inherit;
  font-size: 12px;
  color: rgba(24, 24, 27, 0.9);
  outline: none;
}

.preview-search-state {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}
</style>
