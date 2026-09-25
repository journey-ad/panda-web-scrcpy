<script setup lang="ts">
import { mdiGridLarge, mdiViewGrid } from '@mdi/js';
import { computed, ref, toRef, watch } from 'vue';

import { entryColor, entryIcon } from './icons';
import { buildItemLayout, GRID_ITEM, inCore, type ItemLayout } from '../interaction/geometry';
import { GRID_MAX_COLS, GRID_MIN_COLS, useSettings } from '../shared/settings';
import { useItemDrag } from '../interaction/useItemDrag';
import { useSelection } from '../interaction/useSelection';
import { useThumbnails } from '../media/thumbnails';
import { useVirtualRows } from '../interaction/useVirtualRows';
import type { FileEntry } from '../model/types';
import { formatSize, formatTime } from '../shared/utils';

const props = defineProps<{
  /** 当前目录路径，用于记忆各目录的滚动位置 */
  path: string;
  entries: FileEntry[];
  loading: boolean;
  /** 当前的搜索词，用来区分空目录与无匹配 */
  keyword: string;
  /** 目录里有条目被隐藏或按类型筛掉 */
  filtered: boolean;
  viewMode: 'list' | 'grid';
}>();

const emit = defineEmits<{
  (e: 'activate', entry: FileEntry): void;
  (e: 'navigate', entry: FileEntry): void;
  (e: 'context', entry: FileEntry, event: MouseEvent): void;
  (e: 'blank-context', event: MouseEvent): void;
  (e: 'move', entries: FileEntry[], target: string): void;
}>();

const selected = defineModel<string[]>('selected', { required: true });
const multiSelect = defineModel<boolean>('multiSelect', { required: true });

const prefs = useSettings();
const gridCols = toRef(prefs, 'gridCols');

const bodyRef = ref<HTMLElement | null>(null);

/** 滑块取值与列数相反：自左向右表示图标由小到大 */
const gridSize = computed({
  get: () => GRID_MIN_COLS + GRID_MAX_COLS - gridCols.value,
  set: (value: number) => {
    gridCols.value = GRID_MIN_COLS + GRID_MAX_COLS - value;
  },
});

const visible = toRef(props, 'entries');
const viewMode = toRef(props, 'viewMode');

const listRef = ref<HTMLElement | null>(null);
const gridRef = ref<HTMLElement | null>(null);

/* -------------------------------- 虚拟滚动 -------------------------------- */

const {
  onScroll,
  resetStride,
  rendered,
  padTop,
  padBottom,
  gridStyle,
  inViewport,
  remeasure,
  syncWindow,
  metrics,
} = useVirtualRows({
  body: bodyRef,
  list: listRef,
  grid: gridRef,
  entries: visible,
  viewMode,
  cols: gridCols,
  listShowMeta: toRef(prefs, 'listShowMeta'),
});

const { thumbs, labels, reset: resetThumbs, drop: dropThumb } = useThumbnails(viewMode, inViewport);

const thumbOf = (entry: FileEntry) => thumbs.value.get(entry.path) ?? '';

/** 安装包把应用名跟在文件名后面，其余条目原样显示 */
const nameOf = (entry: FileEntry) => {
  const label = labels.value.get(entry.path);
  return label && label !== entry.name ? `${entry.name} (${label})` : entry.name;
};

/** 仅视频且有缩略图的条目显示角标 */
const showBadge = (entry: FileEntry) => Boolean(thumbOf(entry)) && entry.preview === 'video';

/** 各目录在列表与网格下各自的滚动位置，返回上级或切换视图时恢复 */
const scrollTops = new Map<string, { list: number; grid: number }>();
/** 记住的目录数，超出后丢弃最早的一条 */
const SCROLL_MEMORY = 64;

const scrollSlot = (path: string) => {
  const known = scrollTops.get(path);
  if (known) return known;
  if (scrollTops.size >= SCROLL_MEMORY) {
    const oldest = scrollTops.keys().next().value;
    if (oldest !== undefined) scrollTops.delete(oldest);
  }
  const slot = { list: 0, grid: 0 };
  scrollTops.set(path, slot);
  return slot;
};

/** 单选中的那一项不在可视区内时，自动滚动到可视区域 */
const revealSelected = () => {
  const body = bodyRef.value;
  const path = selected.value.length === 1 ? selected.value[0] : '';
  if (!body || !path) return;
  const cell = Array.from(body.querySelectorAll<HTMLElement>('[data-path]')).find(
    (node) => node.dataset.path === path
  );
  if (!cell) {
    // 虚拟滚动下目标可能没有渲染，按行序号直接定位
    const index = props.entries.findIndex((entry) => entry.path === path);
    if (!metrics.virtual.value || !metrics.rowStep.value || index < 0) return;
    const top = Math.floor(index / metrics.cols.value) * metrics.rowStep.value;
    if (top >= body.scrollTop && top + metrics.rowStep.value <= body.scrollTop + body.clientHeight) return;
    body.scrollTop = top;
    syncWindow();
    return;
  }
  const box = body.getBoundingClientRect();
  const rect = cell.getBoundingClientRect();
  // 已经在可视区内则不动滚动条，保留该视图自己的位置
  if (rect.top >= box.top && rect.bottom <= box.bottom) return;
  cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
};

watch(
  () => props.viewMode,
  async (mode, previous) => {
    // 此刻列表还是旧视图，先把切走那一份的位置记下来
    scrollSlot(props.path)[previous] = bodyRef.value?.scrollTop ?? 0;
    // 两个视图步进不同，先作废测量得到的步进，窗口与留白按新步进计算
    resetStride();
    await remeasure();
    const body = bodyRef.value;
    if (!body) return;
    body.scrollTop = scrollSlot(props.path)[mode];
    syncWindow();
    revealSelected();
  }
);

watch(
  () => props.loading,
  async (loading) => {
    if (loading) {
      // 此刻列表还是上一份内容，先记下位置，加载态会使内容高度变为 0
      scrollSlot(props.path)[props.viewMode] = bodyRef.value?.scrollTop ?? 0;
      resetThumbs();
      return;
    }
    await remeasure();
    const body = bodyRef.value;
    if (props.loading || !body) return;
    body.scrollTop = scrollSlot(props.path)[props.viewMode];
    syncWindow();
    revealSelected();
  }
);

/** 框选命中的布局：条目位置由行列推导，与渲染窗口无关 */
const marqueeLayout = (): ItemLayout | null => {
  const body = bodyRef.value;
  if (!body) return null;
  const { top, left } = metrics.bodyPadding.value;
  return buildItemLayout({
    padTop: top,
    padLeft: left,
    isGrid: metrics.isGrid.value,
    strideX: metrics.strideX.value,
    strideY: metrics.strideY.value,
    itemWidth: metrics.itemWidth.value,
    itemHeight: metrics.itemHeight.value,
    cols: gridCols.value,
    bodyWidth: body.clientWidth,
  });
};

const {
  marqueeRect,
  isSelected,
  setSelection,
  togglePath,
  selectAll,
  invertSelection,
  clearSelected,
  clearSelection,
  onBodyMouseDown,
} = useSelection({
  visible,
  body: bodyRef,
  layout: marqueeLayout,
  selected,
  multiSelect,
  onNavigate: (entry) => emit('navigate', entry),
  onActivate: (entry) => emit('activate', entry),
});

/** 只在核心区域上才高亮 */
const hoverPath = ref('');

const onGridHover = (event: MouseEvent) => {
  const cell = (event.target as HTMLElement).closest<HTMLElement>(GRID_ITEM);
  // 多选态整格都能勾选，整格都高亮
  hoverPath.value =
    cell && (multiSelect.value || inCore(cell, event.clientX, event.clientY))
      ? (cell.dataset.path ?? '')
      : '';
};

/** 网格里只有核心区域算这一项，落在单元空处的右键按空白处处理，由外层接管 */
const onGridContext = (entry: FileEntry, event: MouseEvent) => {
  const cell = event.currentTarget as HTMLElement;
  if (!multiSelect.value && !inCore(cell, event.clientX, event.clientY)) return;
  event.stopPropagation();
  emit('context', entry, event);
};

const onBodyScroll = () => {
  // 滚动后重置悬停高亮
  hoverPath.value = '';
  onScroll();
};

/** 三者都为空时才是真的空目录 */
const emptyHint = computed(() => {
  const keyword = props.keyword.trim();
  if (keyword) return `没有匹配「${keyword}」的文件或目录`;
  return props.filtered ? '当前的筛选条件下没有内容' : '当前目录为空';
});

const sizeLabel = (entry: FileEntry) => (entry.isDirectory ? '—' : formatSize(entry.size));

/** 多选时只有已选中的项可拖，未选中的项按住拖动用来起框选 */
const canDrag = (entry: FileEntry) => !multiSelect.value || isSelected(entry.path);

/* ------------------------------ 拖拽移动 ------------------------------ */

const { dropDir, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop } = useItemDrag({
  visible,
  selected,
  thumbOf,
  onMove: (entries, target) => emit('move', entries, target),
});

/** 工具栏与快捷键驱动的选择动作，锚点与连选基准在列表里维护 */
defineExpose({ setSelection, selectAll, invertSelection, clearSelected, clearSelection });
</script>

<template>
  <div class="fm-browser">
    <div
      ref="bodyRef"
      class="fm-body"
      @mousedown="onBodyMouseDown"
      @scroll="onBodyScroll"
      @contextmenu.prevent="emit('blank-context', $event)"
    >
      <div v-if="loading" class="fm-hint">正在读取目录…</div>
      <div v-else-if="!entries.length" class="fm-hint">{{ emptyHint }}</div>

      <div
        v-else-if="viewMode === 'list'"
        ref="listRef"
        class="fm-list"
        :style="{ paddingTop: `${padTop}px`, paddingBottom: `${padBottom}px` }"
      >
        <div
          v-for="entry in rendered"
          :key="entry.path"
          class="fm-row"
          :class="{ selected: isSelected(entry.path), 'drop-into': dropDir === entry.path, 'no-divider': !prefs.listShowDivider }"
          :data-path="entry.path"
          draggable="true"
          @dragstart="onDragStart(entry, $event)"
          @dragend="onDragEnd"
          @dragover="onDragOver(entry, $event)"
          @dragleave="onDragLeave(entry, $event)"
          @drop="onDrop(entry, $event)"
          @contextmenu.prevent.stop="emit('context', entry, $event)"
        >
          <span class="fm-check-slot" :class="{ open: multiSelect }">
            <input
              type="checkbox"
              class="fm-check"
              :checked="isSelected(entry.path)"
              :tabindex="multiSelect ? 0 : -1"
              @mousedown.stop
              @click.stop
              @change="togglePath(entry.path)"
            />
          </span>
          <v-icon
            size="18"
            :icon="entryIcon(entry)"
            :color="entryColor(entry)"
            class="fm-row-icon"
            :title="entry.name"
          />
          <div class="fm-row-main">
            <div class="fm-row-name" :title="entry.name">{{ entry.name }}</div>
            <div v-if="prefs.listShowMeta" class="fm-row-meta">
              <span>{{ entry.kind }}</span>
              <span class="fm-dot">·</span>
              <span>{{ sizeLabel(entry) }}</span>
              <span class="fm-dot">·</span>
              <span>{{ formatTime(entry.mtime) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div
        v-else
        ref="gridRef"
        class="fm-grid"
        :style="gridStyle"
        @mousemove="onGridHover"
        @mouseleave="hoverPath = ''"
      >
        <div
          v-for="entry in rendered"
          :key="entry.path"
          class="fm-cell"
          :class="{ selected: isSelected(entry.path), 'drop-into': dropDir === entry.path, 'no-border': !prefs.gridShowBorder, 'core-hover': hoverPath === entry.path }"
          :data-path="entry.path"
          :title="entry.name"
          @dragstart="onDragStart(entry, $event)"
          @dragend="onDragEnd"
          @dragover="onDragOver(entry, $event)"
          @dragleave="onDragLeave(entry, $event)"
          @drop="onDrop(entry, $event)"
          @contextmenu.prevent="onGridContext(entry, $event)"
        >
          <input
            type="checkbox"
            class="fm-check fm-cell-check"
            :class="{ open: multiSelect }"
            :checked="isSelected(entry.path)"
            :tabindex="multiSelect ? 0 : -1"
            @mousedown.stop
            @click.stop
            @change="togglePath(entry.path)"
          />
          <div class="fm-cell-preview">
            <img
              v-if="thumbOf(entry)"
              :src="thumbOf(entry)"
              class="fm-cell-thumb"
              alt=""
              :title="entry.name"
              :draggable="canDrag(entry)"
              @error="dropThumb(entry.path)"
            />
            <v-icon
              v-else
              class="fm-cell-icon"
              :draggable="canDrag(entry)"
              :icon="entryIcon(entry)"
              :color="entryColor(entry)"
            />
            <v-icon
              v-if="showBadge(entry)"
              class="fm-cell-badge"
              :icon="entryIcon(entry)"
              size="clamp(18px, calc(var(--cell-w) * 0.25), 32px)"
            />
          </div>
          <div class="fm-cell-name" :draggable="canDrag(entry)">{{ nameOf(entry) }}</div>
          <div class="fm-cell-meta" :draggable="canDrag(entry)">
            {{ entry.isDirectory ? entry.kind : formatSize(entry.size) }}
          </div>
        </div>
      </div>
    </div>

    <div v-if="entries.length" class="fm-footer">
      <span class="fm-footer-text">
        <template v-if="multiSelect">已选 {{ selected.length }} / {{ entries.length }} 项</template>
        <template v-else>
          {{ entries.length }} 项
          <template v-if="keyword.trim()"> · 已按关键字过滤</template>
        </template>
      </span>

      <div v-if="viewMode === 'grid'" class="fm-grid-control">
        <v-icon size="14" :icon="mdiViewGrid" />
        <input
          v-model.number="gridSize"
          type="range"
          class="fm-grid-range"
          :min="GRID_MIN_COLS"
          :max="GRID_MAX_COLS"
          step="1"
          :title="`图标大小（每行 ${gridCols} 个）`"
          aria-label="调整图标大小"
        />
        <v-icon size="14" :icon="mdiGridLarge" />
      </div>
    </div>

    <div
      v-if="marqueeRect"
      class="fm-marquee"
      :style="{
        left: `${marqueeRect.left}px`,
        top: `${marqueeRect.top}px`,
        width: `${marqueeRect.right - marqueeRect.left}px`,
        height: `${marqueeRect.bottom - marqueeRect.top}px`,
      }"
    />
  </div>
</template>

<style scoped>
.fm-browser {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  container-type: inline-size;
}

.fm-body {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  padding: 4px 6px;
  user-select: none;
  -webkit-user-select: none;
}

.fm-hint {
  padding: 24px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}

.fm-list {
  display: flex;
  flex-direction: column;
}

.fm-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 4px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}

.fm-row:hover {
  background: rgba(24, 24, 27, 0.03);
}

.fm-row.no-divider {
  border-bottom-color: transparent;
}

.fm-row.selected,
.fm-cell.selected {
  background: rgba(99, 102, 241, 0.08);
}

.fm-row.drop-into {
  background: rgba(99, 102, 241, 0.14);
  box-shadow: inset 0 0 0 1px rgb(var(--v-theme-accent));
}

.fm-cell.drop-into {
  background: rgba(99, 102, 241, 0.14);
  border-color: rgb(var(--v-theme-accent));
}

.fm-check {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  margin: 0;
  cursor: pointer;
  accent-color: rgb(var(--v-theme-accent));
}

.fm-check-slot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  width: 14px;
  margin-left: -14px;
  margin-right: -6px;
  transition: margin-left 0.18s ease, margin-right 0.18s ease;
}

.fm-check-slot .fm-check {
  opacity: 0;
  pointer-events: none;
  transform: translateX(-6px);
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.fm-check-slot.open {
  margin-left: 0;
  margin-right: 0;
}

.fm-check-slot.open .fm-check {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
}

.fm-row-icon {
  flex-shrink: 0;
}

.fm-row-main {
  flex: 1 1 auto;
  min-width: 0;
}

.fm-row-name {
  font-size: 12px;
  font-weight: 500;
  color: rgba(24, 24, 27, 0.85);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fm-row-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  white-space: nowrap;
}

.fm-dot {
  opacity: 0.5;
}

.fm-grid {
  display: grid;
  --cell-pad: 8px;
  --cell-border: 1px;
  --gap: clamp(6px, calc(8cqw / var(--cols, 4)), 40px);
  --cell-w: calc(
    (100cqw - var(--gap) * (var(--cols, 4) - 1)) / var(--cols, 4) - var(--cell-pad) * 2 -
      var(--cell-border) * 2
  );
  --thumb-gap: calc(var(--cell-w) * 0.06);
  gap: var(--gap);
}

.fm-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px var(--cell-pad) 12px;
  border: 1px solid var(--border);
}

.fm-cell.core-hover {
  border-color: var(--border-hover);
  cursor: pointer;
}

.fm-cell.no-border,
.fm-cell.no-border.core-hover {
  border-color: transparent;
}

.fm-cell.no-border.core-hover:not(.drop-into) {
  background: rgba(24, 24, 27, 0.03);
}

.fm-cell.no-border.drop-into {
  border-color: rgb(var(--v-theme-accent));
}

.fm-cell-check {
  position: absolute;
  top: 3px;
  left: 3px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;
}

.fm-cell-check.open {
  opacity: 1;
  pointer-events: auto;
}

.fm-cell-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1 / 1;
  overflow: hidden;
}

.fm-cell-icon {
  font-size: max(20px, calc(var(--cell-w) * 0.68));
}

.fm-cell-thumb {
  max-width: 100%;
  object-fit: contain;
  max-height: calc(100% - var(--thumb-gap));
  align-self: flex-end;
  margin-bottom: var(--thumb-gap);
}

.fm-cell-badge {
  position: absolute;
  right: 0;
  bottom: var(--thumb-gap);
  max-height: 0.8em;
  padding: 0.05em 0.15em;
  border-radius: 30% 0 0 0;
  background: #5f5e5a;
  color: #fff;
  pointer-events: none;
}

.fm-cell-name,
.fm-cell-meta {
  position: relative;
}

.fm-cell-name {
  max-width: 100%;
  min-width: 50%;
  margin-top: calc(var(--thumb-gap) * -1);
  font-size: 11px;
  color: rgba(24, 24, 27, 0.85);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fm-cell-meta {
  font-size: 10px;
  color: var(--muted);
}

.fm-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--muted);
}

.fm-footer-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fm-grid-control {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.fm-grid-range {
  width: 84px;
  accent-color: rgb(var(--v-theme-accent));
  cursor: pointer;
}

.fm-marquee {
  position: fixed;
  z-index: 6;
  pointer-events: none;
  border: 1px solid rgb(var(--v-theme-accent));
  background: rgba(99, 102, 241, 0.12);
}
</style>
