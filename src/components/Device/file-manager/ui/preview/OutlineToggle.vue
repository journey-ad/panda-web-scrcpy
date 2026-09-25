<script setup lang="ts">
import { mdiTableOfContents } from '@mdi/js';

import { useHeadActions } from './useHeadActions';

/** 目录侧栏的展开状态，识别到目录时默认展开 */
const shown = defineModel<boolean>({ default: true });

const headActions = useHeadActions();

const toggle = () => {
  shown.value = !shown.value;
};
</script>

<template>
  <Teleport v-if="headActions" :to="headActions">
    <v-btn icon variant="text" size="small" :title="shown ? '隐藏章节列表' : '显示章节列表'" @click="toggle">
      <v-icon size="18" :icon="mdiTableOfContents" />
    </v-btn>
  </Teleport>
</template>
