<script setup lang="ts">
import { mdiCheck, mdiFilterOutline, mdiFilterRemoveOutline } from '@mdi/js';
import { computed } from 'vue';

import type { FileFilter } from '../service/useDirectory';
import { useSettings } from '../shared/settings';

const filter = defineModel<FileFilter>({ required: true });

const prefs = useSettings();

const OPTIONS: { value: FileFilter; title: string }[] = [
  { value: 'all', title: '全部类型' },
  { value: 'image', title: '图片' },
  { value: 'video', title: '视频' },
  { value: 'audio', title: '音频' },
  { value: 'document', title: '文档' },
  { value: 'archive', title: '压缩包' },
  { value: 'app', title: '安装包' },
  { value: 'other', title: '其他' },
];

/** 有筛选条件时按钮替换为实心图标，列表外也能看出被过滤过 */
const active = computed(() => filter.value !== 'all' || !prefs.showHidden);
</script>

<template>
  <v-menu location="bottom end">
    <template #activator="{ props: menu }">
      <v-btn
        v-bind="menu"
        icon
        variant="text"
        size="x-small"
        :title="active ? '筛选已生效' : '筛选'"
      >
        <v-icon size="16" :icon="active ? mdiFilterRemoveOutline : mdiFilterOutline" />
      </v-btn>
    </template>
    <v-list density="compact">
      <v-list-item
        v-for="option in OPTIONS"
        :key="option.value"
        :title="option.title"
        :active="filter === option.value"
        @click="filter = option.value"
      >
        <template #append>
          <v-icon v-if="filter === option.value" size="16" :icon="mdiCheck" />
        </template>
      </v-list-item>
      <v-divider />
      <v-list-item title="显示隐藏文件" :active="prefs.showHidden" @click="prefs.showHidden = !prefs.showHidden">
        <template #append>
          <v-icon v-if="prefs.showHidden" size="16" :icon="mdiCheck" />
        </template>
      </v-list-item>
    </v-list>
  </v-menu>
</template>
