<script setup lang="ts">
import { mdiCheck, mdiChevronDown, mdiFormatSize } from '@mdi/js';

import { useSettings, TEXT_SIZES } from '../../shared/settings';
import { useHeadActions } from './useHeadActions';

/** 字号是全局偏好，各文本类预览共用同一个值 */
const prefs = useSettings();
const headActions = useHeadActions();
</script>

<template>
  <Teleport v-if="headActions" :to="headActions">
    <v-menu location="bottom end" :offset="6">
      <template #activator="{ props: menu }">
        <v-btn v-bind="menu" variant="text" size="small" class="preview-chip preview-fontsize" title="字号">
          <v-icon size="15" :icon="mdiFormatSize" />
          <span class="preview-chip-label">{{ prefs.textFontSize }}</span>
          <v-icon size="16" :icon="mdiChevronDown" />
        </v-btn>
      </template>
      <v-list density="compact">
        <v-list-item
          v-for="size in TEXT_SIZES"
          :key="size"
          :active="prefs.textFontSize === size"
          @click="prefs.textFontSize = size"
        >
          <v-list-item-title>{{ size }} px</v-list-item-title>
          <template #append>
            <v-icon v-if="prefs.textFontSize === size" size="16" :icon="mdiCheck" />
          </template>
        </v-list-item>
      </v-list>
    </v-menu>
  </Teleport>
</template>
