<script setup lang="ts">
import { escapeArg } from '@yume-chan/adb';
import { mdiCheck, mdiContentCopy } from '@mdi/js';
import { computed, ref, watch } from 'vue';

import { runShell } from '../device/fs';
import type { FileEntry } from '../model/types';
import { errorText, formatSize } from '../shared/utils';

const props = defineProps<{ modelValue: boolean; entry: FileEntry | null }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'error', message: string): void;
}>();

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

/** 两个命令一次下发，省一次往返；输出每行是「哈希 + 两个空格 + 文件名」 */
const COMMANDS = [
  { title: 'MD5', cmd: 'md5sum' },
  { title: 'SHA1', cmd: 'sha1sum' },
];

const loading = ref(false);
const output = ref('');
const copied = ref('');

/** 提示复制成功，过一会儿自己收回去 */
let copiedTimer = 0;

const values = computed(() => output.value.split('\n').map((line) => line.trim().split(/\s+/)[0] ?? ''));
const rows = computed(() => COMMANDS.map((item, index) => ({ ...item, value: values.value[index] ?? '' })));

const copy = async (title: string, value: string) => {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    copied.value = title;
    clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => (copied.value = ''), 1500);
  } catch (error) {
    emit('error', `复制失败：${errorText(error)}`);
  }
};

const compute = async () => {
  const entry = props.entry;
  if (!entry) return;
  loading.value = true;
  output.value = '';
  copied.value = '';
  try {
    const file = escapeArg(entry.path);
    const { code, output: text } = await runShell(COMMANDS.map((item) => `${item.cmd} ${file}`).join('; '));
    if (code !== 0) throw new Error(text || '设备上没有校验命令');
    output.value = text;
  } catch (error) {
    emit('error', `计算校验和失败：${errorText(error)}`);
    open.value = false;
  } finally {
    loading.value = false;
  }
};

/* 每次打开都重新算一次，文件在设备上可能已经改过 */
watch(
  () => [props.modelValue, props.entry?.path] as const,
  () => {
    if (props.modelValue && props.entry) void compute();
  },
  { immediate: true }
);
</script>

<template>
  <v-dialog v-model="open" max-width="480">
    <v-card>
      <v-card-title>校验和</v-card-title>
      <v-card-text>
        <div class="dialog-note fm-ellipsis" :title="entry?.path">
          {{ entry?.name }} · {{ formatSize(entry?.size ?? 0) }}
        </div>
        <div v-if="loading" class="checksum-wait">正在计算…</div>
        <template v-else>
          <div v-for="row in rows" :key="row.title" class="checksum-row">
            <span class="checksum-label">{{ row.title }}</span>
            <span class="checksum-value">{{ row.value || '—' }}</span>
            <v-btn
              icon
              variant="text"
              size="x-small"
              :title="copied === row.title ? '已复制' : `复制 ${row.title}`"
              :disabled="!row.value"
              @click="copy(row.title, row.value)"
            >
              <v-icon size="15" :icon="copied === row.title ? mdiCheck : mdiContentCopy" />
            </v-btn>
          </div>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn size="small" variant="text" color="secondary" :disabled="loading" @click="compute">
          重新计算
        </v-btn>
        <v-btn size="small" variant="flat" color="primary" @click="open = false">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.checksum-wait {
  padding: 12px 0;
  font-size: 13px;
  color: var(--muted);
}

.checksum-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}

.checksum-label {
  flex: 0 0 44px;
  font-size: 12px;
  color: var(--muted);
}

.checksum-value {
  flex: 1 1 auto;
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: rgba(24, 24, 27, 0.85);
  overflow-wrap: anywhere;
  user-select: text;
  -webkit-user-select: text;
}
</style>
