<template>
  <div class="remote-navigation-bar">
    <v-btn
      variant="text"
      size="large"
      :disabled="!isEnabled"
      @click="handleBack"
    >
      <v-icon :icon="mdiArrowLeft" />
      <v-tooltip activator="parent" location="top">返回</v-tooltip>
    </v-btn>
    
    <v-btn
      variant="text"
      size="large"
      :disabled="!isEnabled"
      @click="handleHome"
    >
      <v-icon :icon="mdiCircleOutline" />
      <v-tooltip activator="parent" location="top">主页</v-tooltip>
    </v-btn>
    
    <v-btn
      variant="text"
      size="large"
      :disabled="!isEnabled"
      @click="handleRecents"
    >
      <v-icon :icon="mdiSquareOutline" />
      <v-tooltip activator="parent" location="top">最近任务</v-tooltip>
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { mdiArrowLeft, mdiCircleOutline, mdiSquareOutline } from '@mdi/js'

import { computed } from 'vue';
import type { RemoteControlCommand } from '@/services/command-types';

const props = defineProps<{
  sendCommand: (cmd: RemoteControlCommand) => void;
  isEnabled?: boolean;
}>();

const isEnabled = computed(() => props.isEnabled !== false);

function handleBack() {
  props.sendCommand({ type: 'key', key: 'back' });
}

function handleHome() {
  props.sendCommand({ type: 'key', key: 'home' });
}

function handleRecents() {
  props.sendCommand({ type: 'key', key: 'recents' });
}
</script>

<style scoped>
.remote-navigation-bar {
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding: 8px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 8px;
}
</style>
