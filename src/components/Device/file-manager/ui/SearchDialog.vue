<script setup lang="ts">
import { mdiDownload, mdiFolderSearchOutline } from '@mdi/js';
import { ref, computed, nextTick, watch } from 'vue';

import { searchFiles, type FoundEntry } from '../device/fs';
import { describeEntry } from '../format/registry';
import { entryColor, entryIcon } from './icons';
import type { FileEntry } from '../model/types';
import { errorText, parentPath } from '../shared/utils';

const props = defineProps<{ modelValue: boolean; root: string }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'open', entry: FileEntry): void;
  (e: 'enter', entry: FileEntry): void;
  (e: 'preview', entry: FileEntry): void;
  (e: 'download', entry: FileEntry): void;
}>();

/** 搜索范围：当前目录，或内部存储的根 */
type Scope = 'here' | 'home';

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const field = ref<HTMLInputElement | null>(null);
const keyword = ref('');
const scope = ref<Scope>('here');
const loading = ref(false);
const searched = ref(false);
const truncated = ref(false);
const failure = ref('');
const results = ref<FileEntry[]>([]);

/** 关掉弹窗后到达的结果丢弃 */
let seq = 0;

/** 结果只给路径，名称与所在目录都从路径里取 */
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

const toEntry = (item: FoundEntry) =>
  describeEntry({
    name: nameOf(item.path),
    path: item.path,
    isDirectory: item.isDirectory,
    isLink: false,
    size: 0,
    mtime: 0,
  });

const run = async () => {
  const text = keyword.value.trim();
  if (!text) return;
  const root = scope.value === 'home' ? '/sdcard' : props.root;
  const token = (seq += 1);
  loading.value = true;
  searched.value = true;
  failure.value = '';
  results.value = [];
  truncated.value = false;
  try {
    const found = await searchFiles(root, text);
    if (token !== seq) return;
    results.value = found.entries.map(toEntry);
    truncated.value = found.truncated;
  } catch (error) {
    if (token !== seq) return;
    failure.value = errorText(error);
  } finally {
    if (token === seq) loading.value = false;
  }
};

const reveal = (entry: FileEntry) => {
  open.value = false;
  emit('open', entry);
};

const enter = (entry: FileEntry) => {
  open.value = false;
  emit('enter', entry);
};

const activate = (entry: FileEntry) => {
  if (entry.isDirectory) enter(entry);
  else emit('preview', entry);
};

/** 打开时清空上一次的结果，并聚焦输入框 */
watch(open, (value) => {
  if (!value) {
    seq += 1;
    loading.value = false;
    return;
  }
  keyword.value = '';
  results.value = [];
  searched.value = false;
  failure.value = '';
  void nextTick(() => field.value?.focus());
});
</script>

<template>
  <v-dialog v-model="open" max-width="640">
    <v-card>
      <v-card-title>在设备上搜索</v-card-title>
      <v-card-text>
        <div class="search-row">
          <input
            ref="field"
            v-model="keyword"
            class="search-input"
            placeholder="文件或目录名，支持 * 通配"
            spellcheck="false"
            autocomplete="off"
            @keydown.enter="run"
          />
          <v-btn-toggle v-model="scope" density="compact" variant="outlined" divided mandatory>
            <v-btn value="here" size="small">当前目录</v-btn>
            <v-btn value="home" size="small">内部存储</v-btn>
          </v-btn-toggle>
          <v-btn size="small" variant="flat" color="primary" :loading="loading" @click="run">搜索</v-btn>
        </div>

        <div class="dialog-note search-note">
          搜索范围：{{ scope === 'home' ? '/sdcard' : root }}
        </div>

        <div v-if="loading" class="search-state">正在搜索…</div>
        <div v-else-if="failure" class="search-state">搜索失败：{{ failure }}</div>
        <div v-else-if="!searched" class="search-state">输入名称后回车开始搜索</div>
        <div v-else-if="!results.length" class="search-state">没有找到匹配的文件或目录</div>
        <template v-else>
          <div class="search-state">找到 {{ results.length }} 项{{ truncated ? '，只显示前 500 项' : '' }}</div>
          <div class="search-results">
            <div v-for="entry in results" :key="entry.path" class="search-item" :title="entry.path">
              <button type="button" class="search-main" @click="activate(entry)">
                <v-icon size="18" :icon="entryIcon(entry)" :color="entryColor(entry)" />
                <span class="search-item-name">{{ entry.name }}</span>
                <span class="search-item-dir">{{ parentPath(entry.path) }}</span>
              </button>
              <div class="search-actions">
                <v-btn
                  v-if="!entry.isDirectory"
                  class="search-action"
                  icon
                  variant="text"
                  size="x-small"
                  title="下载到本机"
                  @click="emit('download', entry)"
                >
                  <v-icon size="16" :icon="mdiDownload" />
                </v-btn>
                <v-btn
                  class="search-action"
                  icon
                  variant="text"
                  size="x-small"
                  title="打开所在目录"
                  @click="reveal(entry)"
                >
                  <v-icon size="16" :icon="mdiFolderSearchOutline" />
                </v-btn>
              </div>
            </div>
          </div>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn size="small" variant="flat" color="primary" @click="open = false">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.search-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: #fff;
  font-size: 13px;
  color: rgba(24, 24, 27, 0.9);
  outline: none;
}

.search-input:focus {
  border-color: #6366f1;
}

.search-note {
  margin-top: 6px;
}

.search-state {
  margin-top: 10px;
  font-size: 12px;
  color: var(--muted);
}

.search-results {
  max-height: 320px;
  margin-top: 6px;
  overflow: auto;
}

.search-item {
  display: flex;
  align-items: center;
  border-radius: 4px;
}

.search-item:hover {
  background: rgba(24, 24, 27, 0.05);
}

.search-main {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 5px 6px;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
}

.search-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  padding-right: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
}

.search-item:hover .search-actions,
.search-item:focus-within .search-actions {
  opacity: 1;
  pointer-events: auto;
}

.search-action {
  width: 24px;
  min-width: 24px;
  height: 24px;
}

.search-item-name {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 13px;
  color: rgba(24, 24, 27, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-item-dir {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
