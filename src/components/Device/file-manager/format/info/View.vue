<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import type { ArchiveListing, ArchiveNode } from '../archive/listing';
import { isExtractableArchive } from '../archive/extract';
import { previewOfHead, sniffFormat, withinLimit } from '../registry';
import { headText, hexDump, infoRows, readArchive, readHead, readListing } from './reader';
import { useHeadActions } from '../../ui/preview/useHeadActions';
import { usePreviewScope } from '../../ui/preview/usePreviewScope';
import type { FileEntry, PreviewKind } from '../../model/types';
import { formatSize } from '../../shared/utils';

const props = defineProps<{ entry: FileEntry }>();
const emit = defineEmits<{
  (e: 'error', message: string): void;
  (e: 'extract'): void;
  (e: 'preview', kind: PreviewKind): void;
}>();

const { loading, stop } = usePreviewScope((message) => emit('error', message));

/** 解压由设备执行，只有设备上有对应命令的格式才给入口 */
const extractable = computed(() => isExtractableArchive(props.entry.name));
const headActions = useHeadActions();

const head = ref<Uint8Array>(new Uint8Array());
const headNote = ref('');
const listing = ref('');
const archive = ref<ArchiveListing | null>(null);

/** 文件树展开为纯文本，连线按 tree 命令的风格绘制 */
const archiveText = computed(() => {
  if (!archive.value) return '';
  const lines: string[] = [];
  const walk = (nodes: ArchiveNode[], prefix: string) => {
    nodes.forEach((node, index) => {
      const last = index === nodes.length - 1;
      const label = node.isDirectory ? node.name : `${node.name}  [${formatSize(node.size)}]`;
      lines.push(`${prefix}${last ? '└── ' : '├── '}${label}`);
      if (node.isDirectory) walk(node.children, `${prefix}${last ? '    ' : '│   '}`);
    });
  };
  walk(archive.value.tree, '');
  return lines.join('\n');
});

/** 截断时显示在树末尾的提示 */
const archiveRest = computed(() => {
  const list = archive.value;
  if (!list?.truncated) return '';
  const remaining = list.total - list.count;
  return remaining > 0 ? `…剩余 ${remaining} 个文件` : '…后续条目未读取';
});

const format = computed(() => sniffFormat(head.value));
const dump = computed(() => hexDump(head.value));
const text = computed(() => headText(head.value));
const info = computed(() => infoRows(props.entry, format.value));

/** 文件头认出的格式若在预览上限内，这一行给出用预览组件打开的入口 */
const previewable = computed(() => {
  const kind = previewOfHead(head.value);
  return kind && withinLimit(kind, props.entry.size) ? kind : null;
});

const openPreview = () => {
  if (previewable.value) emit('preview', previewable.value);
};

onMounted(async () => {
  const [result, ls] = await Promise.all([readHead(props.entry), readListing(props.entry)]);
  head.value = result.bytes;
  headNote.value = result.note;
  listing.value = ls;
  stop();
  if (result.bytes.length) {
    archive.value = await readArchive(props.entry, result.reader, result.bytes);
  }
});
</script>

<template>
  <Teleport v-if="headActions && extractable" :to="headActions">
    <v-btn
      class="preview-head-action"
      size="small"
      variant="text"
      color="primary"
      title="解压到当前目录"
      @click="emit('extract')"
    >
      解压
    </v-btn>
  </Teleport>

  <div class="preview-info">
    <div class="info-grid">
      <template v-for="row in info" :key="row.key">
        <div class="info-key">{{ row.key }}</div>
        <div class="info-value" :title="row.value">
          <span>{{ row.value }}</span>
          <v-btn
            v-if="row.action && previewable"
            class="info-action"
            size="x-small"
            variant="text"
            color="info"
            @click="openPreview"
          >
            点击预览
          </v-btn>
        </div>
      </template>
    </div>

    <div v-if="listing" class="info-raw">{{ listing }}</div>

    <template v-if="archive">
      <div class="info-title">
        归档内容
        <span class="info-sub">
          {{ archive.format }}<template v-if="archive.total"> · 包含 {{ archive.total }} 个文件</template>
        </span>
      </div>
      <div v-if="archive.note" class="info-raw">{{ archive.note }}</div>
      <div v-else class="archive-tree">
        <pre class="archive-text">{{ archiveText }}</pre>
        <div v-if="archiveRest" class="archive-rest">{{ archiveRest }}</div>
      </div>
    </template>

    <template v-if="dump">
      <div class="info-title">文件头（前 {{ head.length }} 字节）</div>
      <pre class="info-hex">{{ dump }}</pre>
    </template>

    <template v-if="text">
      <div class="info-title">文本内容</div>
      <pre class="info-text">{{ text }}</pre>
    </template>

    <div v-if="loading" class="preview-hint">正在读取文件信息…</div>
    <div v-else-if="headNote" class="preview-hint">{{ headNote }}</div>
  </div>
</template>

<style scoped>
.preview-info {
  align-self: stretch;
  width: 100%;
  height: 100%;
  overflow: auto;
  font-size: 12px;
}

.info-grid {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 4px 12px;
  padding: 4px 2px 12px;
}

.info-key {
  color: var(--muted);
}

.info-value {
  display: flex;
  align-items: center;
  color: rgba(24, 24, 27, 0.9);
  word-break: break-all;
}

.info-action {
  flex-shrink: 0;
  height: 18px;
  padding: 0 6px;
  font-size: 12px;
  font-weight: 500;
  text-transform: none;
}

.info-raw {
  padding: 6px 8px;
  border: 1px solid var(--border);
  background: rgba(24, 24, 27, 0.03);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: rgba(24, 24, 27, 0.75);
  word-break: break-all;
}

.info-title {
  padding: 12px 2px 6px;
  font-weight: 500;
  color: rgba(24, 24, 27, 0.85);
}

.info-sub {
  margin-left: 6px;
  font-weight: 400;
  color: var(--muted);
}

.info-hex,
.info-text {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre;
  color: rgba(24, 24, 27, 0.85);
}

.archive-tree {
  border: 1px solid var(--border);
  background: rgba(24, 24, 27, 0.03);
}

.archive-text {
  margin: 0;
  padding: 6px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.7;
  white-space: pre;
  color: rgba(24, 24, 27, 0.85);
}

.archive-rest {
  padding: 0 8px 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  font-style: italic;
  color: var(--muted);
}
</style>
