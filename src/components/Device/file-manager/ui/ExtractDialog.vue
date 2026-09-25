<script setup lang="ts">
import { mdiArchiveArrowDownOutline, mdiFolderOutline } from '@mdi/js';
import { computed } from 'vue';

import type { FileEntry } from '../model/types';

/** 待解压的条目与目标目录由父级传入，确认后由父级执行 */
const props = defineProps<{ entry: FileEntry | null; target: string; busy?: boolean }>();
const emit = defineEmits<{ (e: 'confirm'): void }>();

const open = defineModel<boolean>({ required: true });

const title = computed(() => (props.entry ? `解压「${props.entry.name}」` : '解压压缩包'));
</script>

<template>
  <v-dialog v-model="open" max-width="400">
    <v-card>
      <v-card-title>{{ title }}</v-card-title>
      <v-card-text>
        <div class="extract-facts">
          <div class="extract-row">
            <v-icon size="16" :icon="mdiArchiveArrowDownOutline" color="amber-darken-2" />
            <span class="extract-label">压缩包</span>
            <span class="extract-value" :title="entry?.name">{{ entry?.name }}</span>
          </div>
          <div class="extract-row">
            <v-icon size="16" :icon="mdiFolderOutline" color="amber-darken-2" />
            <span class="extract-label">解压到</span>
            <span class="extract-value" :title="target">{{ target }}</span>
          </div>
        </div>
        <div class="dialog-note">同名文件会被覆盖，原压缩包保留</div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn size="small" variant="text" color="secondary" :disabled="busy" @click="open = false">取消</v-btn>
        <v-btn size="small" variant="flat" color="primary" :loading="busy" @click="emit('confirm')">解压</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.extract-facts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  background: rgba(24, 24, 27, 0.02);
}

.extract-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
}

.extract-label {
  flex: 0 0 auto;
  min-width: 56px;
  white-space: nowrap;
  color: var(--muted);
}

.extract-value {
  flex: 1 1 auto;
  min-width: 0;
  color: rgba(24, 24, 27, 0.85);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
