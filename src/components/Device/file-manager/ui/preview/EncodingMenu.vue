<script setup lang="ts">
import { mdiCheck, mdiChevronDown } from '@mdi/js';
import { computed } from 'vue';

import { ENCODINGS, encodingName } from '../../shared/encoding';
import { useHeadActions } from './useHeadActions';

/** null 表示跟随自动探测 */
const encoding = defineModel<string | null>({ default: null });
/** 预览组件探测出的编码，只用于展示 */
defineProps<{ detected?: string }>();

const headActions = useHeadActions();

const label = computed(() => (encoding.value ? encodingName(encoding.value) : '编码'));
</script>

<template>
  <Teleport v-if="headActions" :to="headActions">
    <v-menu location="bottom end" :offset="6">
      <template #activator="{ props: menu }">
        <v-btn v-bind="menu" variant="text" size="small" class="preview-chip preview-encoding" title="文本编码">
          <span class="preview-chip-label">{{ label }}</span>
          <v-icon size="16" :icon="mdiChevronDown" />
        </v-btn>
      </template>
      <v-list density="compact" class="preview-encoding-list">
        <v-list-item :active="encoding === null" @click="encoding = null">
          <v-list-item-title>自动探测</v-list-item-title>
          <v-list-item-subtitle v-if="detected">{{ encodingName(detected) }}</v-list-item-subtitle>
          <template #append>
            <v-icon v-if="encoding === null" size="16" :icon="mdiCheck" />
          </template>
        </v-list-item>
        <v-divider class="my-1" />
        <v-list-item
          v-for="item in ENCODINGS"
          :key="item.value"
          :active="encoding === item.value"
          @click="encoding = item.value"
        >
          <v-list-item-title>{{ item.name }}</v-list-item-title>
          <template #append>
            <v-icon v-if="encoding === item.value" size="16" :icon="mdiCheck" />
          </template>
        </v-list-item>
      </v-list>
    </v-menu>
  </Teleport>
</template>

<style scoped>
.preview-encoding {
  flex-shrink: 0;
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  text-transform: none;
  color: rgba(24, 24, 27, 0.7);
  background: rgba(24, 24, 27, 0.04);
  transition: background-color 0.15s ease;
  --v-hover-opacity: 0;
}

.preview-encoding:hover {
  background: rgba(24, 24, 27, 0.08);
}

.preview-encoding-list {
  max-height: 320px;
}
</style>
