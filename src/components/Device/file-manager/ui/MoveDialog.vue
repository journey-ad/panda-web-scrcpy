<script setup lang="ts">
import { mdiArrowUp, mdiFolder } from '@mdi/js';
import { ref, watch } from 'vue';

import { readDir } from '../device/fs';
import { describeEntry } from '../format/registry';
import type { FileEntry } from '../model/types';
import { errorText, parentPath } from '../shared/utils';

/** 待移动的条目，可选目录里要排除它自身 */
const props = defineProps<{ entries: FileEntry[]; initial: string }>();
const emit = defineEmits<{
  (e: 'confirm', target: string): void;
  (e: 'error', message: string): void;
}>();

const open = defineModel<boolean>({ required: true });

const target = ref('');
const dirs = ref<FileEntry[]>([]);
const loading = ref(false);

/** 连续进入多层目录时只有最后发起的那次读取生效 */
let loadSeq = 0;

const load = async (path: string) => {
  const seq = (loadSeq += 1);
  loading.value = true;
  try {
    const blocked = new Set(props.entries.map((entry) => entry.path));
    const items = (await readDir(path)).map(describeEntry);
    if (seq !== loadSeq) return;
    dirs.value = items.filter((item) => item.isDirectory && !blocked.has(item.path));
  } catch (error) {
    if (seq !== loadSeq) return;
    dirs.value = [];
    emit('error', `读取目录失败：${errorText(error)}`);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
};

const enter = (path: string) => {
  target.value = path;
  load(path);
};

watch(open, (value) => {
  if (!value) return;
  target.value = props.initial;
  load(props.initial);
});
</script>

<template>
  <v-dialog v-model="open" max-width="400">
    <v-card>
      <v-card-title>
        {{ entries.length > 1 ? `移动 ${entries.length} 项` : `移动「${entries[0]?.name}」` }}
      </v-card-title>
      <v-card-text>
        <div class="move-pathbar">
          <v-btn
            icon
            variant="text"
            size="x-small"
            title="上一级"
            :disabled="target === '/'"
            @click="enter(parentPath(target))"
          >
            <v-icon size="16" :icon="mdiArrowUp" />
          </v-btn>
          <span class="move-path" :title="target">{{ target }}</span>
        </div>
        <div class="move-list">
          <div v-if="loading" class="move-hint">正在读取目录…</div>
          <div v-else-if="!dirs.length" class="move-hint">
            这里没有子目录，可点上方箭头回到上一级
          </div>
          <button
            v-for="dir in dirs"
            :key="dir.path"
            type="button"
            class="move-item"
            @click="enter(dir.path)"
          >
            <v-icon size="16" :icon="mdiFolder" color="amber-darken-2" />
            <span class="move-name">{{ dir.name }}</span>
          </button>
        </div>
        <div class="dialog-note">目标目录里已有同名文件时会被覆盖</div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn size="small" variant="text" color="secondary" @click="open = false">取消</v-btn>
        <v-btn size="small" variant="flat" color="primary" @click="emit('confirm', target)">移动</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.move-pathbar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}

.move-path {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  color: rgba(24, 24, 27, 0.85);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.move-list {
  max-height: 220px;
  overflow: auto;
  border: 1px solid var(--border);
}

.move-hint {
  padding: 24px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}

.move-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: none;
  font-size: 12px;
  color: rgba(24, 24, 27, 0.85);
  text-align: left;
  cursor: pointer;
}

.move-item:last-child {
  border-bottom: none;
}

.move-item:hover {
  background: rgba(24, 24, 27, 0.03);
}

.move-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
