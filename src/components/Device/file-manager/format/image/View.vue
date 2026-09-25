<script setup lang="ts">
import {
  mdiFlipHorizontal,
  mdiMagnifyMinusOutline,
  mdiMagnifyPlusOutline,
  mdiRotateLeft,
  mdiRotateRight,
} from '@mdi/js';
import { computed, onUnmounted, ref } from 'vue';

import { mimeOf } from '../../model/mime';
import { readEntry } from '../../service/readEntry';
import { loopAnimatedWebp } from './bitmap';
import { useHeadActions } from '../../ui/preview/useHeadActions';
import { usePreviewScope } from '../../ui/preview/usePreviewScope';
import type { FileEntry } from '../../model/types';

const props = defineProps<{ entry: FileEntry }>();
const emit = defineEmits<{ (e: 'error', message: string): void }>();

const { signal, done, fail } = usePreviewScope((message) => emit('error', message));

const url = ref('');
const progress = ref(0);

const headActions = useHeadActions();
const stage = ref<HTMLElement | null>(null);

/** 缩放范围与每次缩放的倍率 */
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const STEP = 1.25;

const scale = ref(1);
const rotation = ref(0);
const flipped = ref(false);
const offset = ref({ x: 0, y: 0 });
const dragging = ref(false);

const imageStyle = computed(() => ({
  transform: `translate(${offset.value.x}px, ${offset.value.y}px) scale(${scale.value}) rotate(${rotation.value}deg) scaleX(${flipped.value ? -1 : 1})`,
}));

const reset = () => {
  scale.value = 1;
  rotation.value = 0;
  flipped.value = false;
  offset.value = { x: 0, y: 0 };
};

const rotateBy = (deg: number) => {
  rotation.value = (rotation.value + deg + 360) % 360;
};

/**
 * 缩放：给了指针位置就以指针为锚点，指针下的那一处内容保持不动
 * 平移量在旋转之外，换算时不考虑旋转角
 */
const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value * factor));
  if (next === scale.value) return;
  const box = stage.value;
  if (!box || clientX === undefined || clientY === undefined) {
    scale.value = next;
    return;
  }
  const rect = box.getBoundingClientRect();
  const dx = clientX - (rect.left + rect.width / 2);
  const dy = clientY - (rect.top + rect.height / 2);
  const ratio = next / scale.value;
  offset.value = {
    x: dx - (dx - offset.value.x) * ratio,
    y: dy - (dy - offset.value.y) * ratio,
  };
  scale.value = next;
};

const onWheel = (event: WheelEvent) => {
  zoomAt(event.deltaY < 0 ? STEP : 1 / STEP, event.clientX, event.clientY);
};

let dragStart: { x: number; y: number; ox: number; oy: number } | null = null;

const onPointerDown = (event: PointerEvent) => {
  if (event.button !== 0) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  dragging.value = true;
  dragStart = { x: event.clientX, y: event.clientY, ox: offset.value.x, oy: offset.value.y };
};

const onPointerMove = (event: PointerEvent) => {
  if (!dragStart) return;
  offset.value = {
    x: dragStart.ox + event.clientX - dragStart.x,
    y: dragStart.oy + event.clientY - dragStart.y,
  };
};

const onPointerUp = () => {
  dragStart = null;
  dragging.value = false;
};

const load = async () => {
  const { entry } = props;
  try {
    const bytes = await readEntry(entry, { signal, onProgress: (value) => (progress.value = value) });
    // 预览直接播放原文件：动图由浏览器按帧解析并自动播放，
    // WebP 中记录的循环次数在这里改为无限循环；网格缩略图仍取首帧
    const blob = await loopAnimatedWebp(new Blob([bytes as BlobPart], { type: mimeOf(entry.name) }));
    if (done()) return;
    url.value = URL.createObjectURL(blob);
  } catch (error) {
    fail(error);
  }
};

load();

onUnmounted(() => {
  if (url.value) URL.revokeObjectURL(url.value);
});
</script>

<template>
  <Teleport v-if="headActions && url" :to="headActions">
    <v-btn
      class="preview-head-action"
      icon
      size="small"
      variant="text"
      title="缩小"
      :disabled="scale <= MIN_SCALE"
      @click="zoomAt(1 / STEP)"
    >
      <v-icon size="18" :icon="mdiMagnifyMinusOutline" />
    </v-btn>
    <v-btn class="preview-head-action" size="small" variant="text" title="恢复原始大小" @click="reset">
      <span class="preview-zoom-value">{{ Math.round(scale * 100) }}%</span>
    </v-btn>
    <v-btn
      class="preview-head-action"
      icon
      size="small"
      variant="text"
      title="放大"
      :disabled="scale >= MAX_SCALE"
      @click="zoomAt(STEP)"
    >
      <v-icon size="18" :icon="mdiMagnifyPlusOutline" />
    </v-btn>
    <v-btn
      class="preview-head-action"
      icon
      size="small"
      variant="text"
      title="水平镜像"
      @click="flipped = !flipped"
    >
      <v-icon size="18" :icon="mdiFlipHorizontal" />
    </v-btn>
    <v-btn
      class="preview-head-action"
      icon
      size="small"
      variant="text"
      title="向左旋转"
      @click="rotateBy(-90)"
    >
      <v-icon size="18" :icon="mdiRotateLeft" />
    </v-btn>
    <v-btn
      class="preview-head-action"
      icon
      size="small"
      variant="text"
      title="向右旋转"
      @click="rotateBy(90)"
    >
      <v-icon size="18" :icon="mdiRotateRight" />
    </v-btn>
  </Teleport>

  <div
    v-if="url"
    ref="stage"
    class="preview-image-stage"
    :class="{ dragging }"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <img :src="url" class="preview-image" :style="imageStyle" alt="" draggable="false" />
  </div>
  <div v-else class="preview-hint">正在加载 {{ Math.round(progress * 100) }}%</div>
</template>

<style scoped>
.preview-image-stage {
  align-self: stretch;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
}

.preview-image-stage.dragging {
  cursor: grabbing;
}

.preview-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transform-origin: center center;
  user-select: none;
  -webkit-user-drag: none;
}

.preview-zoom-value {
  margin-right: 2px;
  font-size: 12px;
}
</style>
