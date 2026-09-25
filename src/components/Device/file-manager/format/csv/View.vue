<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { extensionOf } from '../../model/mime';
import { decodeText } from '../../shared/encoding';
import { readEntry } from '../../service/readEntry';
import { useSettings } from '../../shared/settings';
import { usePreviewScope } from '../../ui/preview/usePreviewScope';
import type { FileEntry } from '../../model/types';
import EncodingMenu from '../../ui/preview/EncodingMenu.vue';
import FontSizeMenu from '../../ui/preview/FontSizeMenu.vue';

const props = defineProps<{ entry: FileEntry }>();
const emit = defineEmits<{ (e: 'error', message: string): void }>();

const { signal, loading, done, fail, stop } = usePreviewScope((message) => emit('error', message));

const prefs = useSettings();
/** 编码只在本次预览内有效，换文件时随组件一起重建 */
const encoding = ref<string | null>(null);
const detected = ref('');

/** 表格预览的渲染上限 */
const MAX_ROWS = 300;
const MAX_COLS = 40;

const rows = ref<string[][]>([]);
const progress = ref(0);

let bytes: Uint8Array | null = null;

const visibleRows = computed(() => rows.value.slice(0, MAX_ROWS).map((row) => row.slice(0, MAX_COLS)));
const truncated = computed(() => rows.value.length > MAX_ROWS || rows.value.some((row) => row.length > MAX_COLS));

/** 分隔文本按引号规则拆分，逗号与制表符共用 */
const parse = (text: string, delimiter: string) => {
  const result: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') {
        cell += char;
      } else if (text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = false;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      result.push(row);
      row = [];
      cell = '';
      // 只解析到展示上限，大表格后面的内容停止拆分
      if (result.length > MAX_ROWS) break;
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    result.push(row);
  }
  return result;
};

const render = () => {
  if (!bytes) return;
  const { encoding: used, text } = decodeText(bytes, encoding.value);
  detected.value = used;
  if (done()) return;
  rows.value = parse(text, extensionOf(props.entry.name) === 'tsv' ? '\t' : ',');
};

const load = async () => {
  const { entry } = props;
  try {
    bytes = await readEntry(entry, { signal, onProgress: (value) => (progress.value = value) });
    if (done()) return;
    render();
  } catch (error) {
    fail(error);
  } finally {
    stop();
  }
};

load();

watch(encoding, () => render());
</script>

<template>
  <!-- 字号菜单 -->
  <FontSizeMenu />
  <!-- 编码菜单 -->
  <EncodingMenu v-model="encoding" :detected="detected" />

  <div v-if="visibleRows.length" class="preview-sheet" :style="{ fontSize: `${prefs.textFontSize}px` }">
    <table>
      <tbody>
        <tr v-for="(row, rowIndex) in visibleRows" :key="rowIndex">
          <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
        </tr>
      </tbody>
    </table>
    <div v-if="truncated" class="preview-note">
      仅显示前 {{ MAX_ROWS }} 行 / {{ MAX_COLS }} 列
    </div>
  </div>
  <div v-else class="preview-hint">
    {{ loading ? `正在加载 ${Math.round(progress * 100)}%` : '文件为空' }}
  </div>
</template>

<style scoped>
.preview-sheet {
  align-self: stretch;
  width: 100%;
  max-height: 100%;
  overflow: auto;
}

.preview-sheet table {
  border-collapse: collapse;
}

.preview-sheet td {
  max-width: 220px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
