<script setup lang="ts">
import '@vue-office/docx/lib/index.css';
import '@vue-office/excel/lib/index.css';
import { mdiMagnifyMinusOutline, mdiMagnifyPlusOutline } from '@mdi/js';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, type Component } from 'vue';

import { readEntry } from '../../service/readEntry';
import { usePreviewScope } from '../../ui/preview/usePreviewScope';
import type { FileEntry, OfficeKind } from '../../model/types';
import { errorText } from '../../shared/utils';

const props = defineProps<{ entry: FileEntry }>();
const emit = defineEmits<{ (e: 'error', message: string): void }>();

const { signal, loading, done, fail, stop } = usePreviewScope((message) => emit('error', message));

/** 按需加载，未打开对应类型时不会打包 */
const LOADERS: Record<OfficeKind, () => Promise<{ default: unknown }>> = {
  docx: () => import('@vue-office/docx'),
  xlsx: () => import('@vue-office/excel'),
  pptx: () => import('@vue-office/pptx'),
  pdf: () => import('@vue-office/pdf'),
};

/** 未内嵌字体的中文 PDF 改用系统字体 */
const PDF_BINDINGS = {
  options: {
    cMapPacked: true,
    useSystemFonts: true,
  },
};

/** 分页显示，并渲染页眉页脚与脚注尾注 */
const DOCX_OPTIONS = {
  breakPages: true,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  renderEndnotes: true,
  useBase64URL: true,
};

/** 按内容实际行列渲染，小表不会铺满空单元格 */
const EXCEL_OPTIONS = { minColLength: 0, minRowLength: 0, widthOffset: 10, heightOffset: 10 };

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const ZOOM_STEP = 0.25;

/** PDF 组件通过 ref 暴露的缩放接口，getScale 返回的是 ref 对象因此只用自己的记录 */
interface PdfApi {
  setScale: (value: number) => void;
}

/** 尺寸稳定后再重建，拖动窗口的过程中不反复渲染 */
const RESIZE_DEBOUNCE = 120;

const host = ref<HTMLElement | null>(null);
const officeRef = ref<PdfApi | null>(null);
const view = shallowRef<Component | null>(null);
const data = shallowRef<ArrayBuffer | null>(null);
const size = ref({ width: 0, height: 0 });
const scale = ref(1);
const progress = ref(0);

let observer: ResizeObserver | null = null;
let resizeTimer: number | undefined;

/** 各类型交给组件的属性：office 的 options、PPTX 的尺寸、PDF 的静态资源路径 */
const bindings = computed<Record<string, unknown>>(() => {
  const kind = props.entry.preview as OfficeKind;
  if (kind === 'docx') return { options: DOCX_OPTIONS };
  if (kind === 'xlsx') return { options: EXCEL_OPTIONS };
  // PPTX 只接受容器尺寸，用布局尺寸而非包含缩放的 getBoundingClientRect
  if (kind === 'pptx') return { options: { width: size.value.width || 960, height: size.value.height || 540 } };
  return PDF_BINDINGS;
});

/** 画布尺寸在初始化时即读取的类型：容器变化只能重建，文件字节仍保留在内存中，不会重新读取设备 */
const SIZE_BOUND: OfficeKind[] = ['pptx', 'xlsx'];

const sizeKey = computed(() =>
  SIZE_BOUND.includes(props.entry.preview as OfficeKind) && size.value.width
    ? `${size.value.width}x${size.value.height}`
    : undefined
);

const load = async () => {
  const { entry } = props;
  const kind = entry.preview as OfficeKind;
  try {
    const loaded = await readEntry(entry, { signal, onProgress: (value) => (progress.value = value) });
    // Excel 内部调用 workbook.xlsx.load，只接受 ArrayBuffer 与 Uint8Array
    const [bytes, module] = await Promise.all([
      Promise.resolve(loaded.buffer as ArrayBuffer),
      LOADERS[kind](),
    ]);
    if (done()) return;
    data.value = bytes;
    await nextTick();
    view.value = module.default as Component;
  } catch (error) {
    fail(error);
  } finally {
    stop();
  }
};

/**
 * setScale 会重新加载整篇文档，加载期间再次调用会让两次加载互相打断
 * 因此加载中只记录目标比例，等 rendered 事件确认本次加载结束后再应用
 */
let rendering = false;
let pendingScale: number | null = null;

const applyScale = (value: number) => {
  if (rendering) {
    pendingScale = value;
    return;
  }
  rendering = true;
  officeRef.value?.setScale(value);
};

const onRendered = () => {
  rendering = false;
  const next = pendingScale;
  pendingScale = null;
  if (next !== null) applyScale(next);
};

const zoomBy = (step: number) => {
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((scale.value + step) * 100) / 100));
  if (next === scale.value) return;
  scale.value = next;
  applyScale(next);
};

const onError = (payload: unknown) => {
  rendering = false;
  pendingScale = null;
  emit('error', errorText(payload));
};

load();

onMounted(() => {
  const el = host.value;
  if (!el) return;
  size.value = { width: el.clientWidth, height: el.clientHeight };
  observer = new ResizeObserver(() => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (!width || !height) return;
      if (width === size.value.width && height === size.value.height) return;
      size.value = { width, height };
    }, RESIZE_DEBOUNCE);
  });
  observer.observe(el);
});

onUnmounted(() => {
  observer?.disconnect();
  window.clearTimeout(resizeTimer);
});

/** 仅 PDF 提供拖拽平移阅读，其余格式沿用原生滚动 */
const isPdf = computed(() => props.entry.preview === 'pdf');

/** PDF 渲染出的根节点内联了 overflow-y: auto，是唯一的滚动容器 */
const panning = ref(false);
const pan = { scroller: null as HTMLElement | null, x: 0, y: 0 };

const onPointerDown = (event: PointerEvent) => {
  if (!isPdf.value || event.button !== 0) return;
  // 缩放按钮不在平移范围内，点击不被平移拦截
  if ((event.target as HTMLElement)?.closest('.preview-zoom')) return;
  const scroller = host.value?.querySelector<HTMLElement>('.vue-office-pdf');
  if (!scroller) return;
  pan.scroller = scroller;
  pan.x = event.clientX;
  pan.y = event.clientY;
  panning.value = true;
  host.value?.setPointerCapture(event.pointerId);
};

const onPointerMove = (event: PointerEvent) => {
  if (!panning.value || !pan.scroller) return;
  const dx = event.clientX - pan.x;
  const dy = event.clientY - pan.y;
  pan.x = event.clientX;
  pan.y = event.clientY;
  pan.scroller.scrollLeft -= dx;
  pan.scroller.scrollTop -= dy;
};

const onPointerUp = (event: PointerEvent) => {
  if (!panning.value) return;
  panning.value = false;
  pan.scroller = null;
  host.value?.releasePointerCapture?.(event.pointerId);
};
</script>

<template>
  <div
    ref="host"
    class="preview-office"
    :class="{ 'is-pdf': isPdf, 'is-panning': panning }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <component
      :is="view"
      v-if="view"
      :key="sizeKey"
      ref="officeRef"
      :src="data"
      v-bind="bindings"
      @rendered="onRendered"
      @error="onError"
    />
    <div v-if="loading" class="preview-hint">正在加载 {{ Math.round(progress * 100) }}%</div>
    <div v-if="view && entry.preview === 'pdf'" class="preview-zoom">
      <v-btn
        icon
        variant="text"
        size="x-small"
        title="缩小"
        :disabled="scale <= MIN_SCALE"
        @click="zoomBy(-ZOOM_STEP)"
      >
        <v-icon size="16" :icon="mdiMagnifyMinusOutline" />
      </v-btn>
      <span class="preview-zoom-value">{{ Math.round(scale * 100) }}%</span>
      <v-btn
        icon
        variant="text"
        size="x-small"
        title="放大"
        :disabled="scale >= MAX_SCALE"
        @click="zoomBy(ZOOM_STEP)"
      >
        <v-icon size="16" :icon="mdiMagnifyPlusOutline" />
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.preview-office {
  position: relative;
  align-self: stretch;
  width: 100%;
  height: 100%;
  overflow: hidden;
  text-align: left;
}

.preview-office.is-pdf {
  cursor: grab;
}

.preview-office.is-pdf.is-panning {
  cursor: grabbing;
}

.preview-office.is-panning {
  user-select: none;
}

.preview-office.is-pdf :deep(.vue-office-pdf),
.preview-office.is-pdf :deep(.textLayer) {
  cursor: inherit;
}

.preview-office > .preview-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-office :deep(.vue-office-docx),
.preview-office :deep(.vue-office-excel),
.preview-office :deep(.vue-office-excel-main),
.preview-office :deep(.vue-office-pdf),
.preview-office :deep(.vue-office-pptx) {
  height: 100%;
}

.preview-office :deep(.vue-office-pdf) {
  font-family: system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
}

.preview-zoom {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 1px 4px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.94);
  color: var(--muted);
  box-shadow: 0 1px 4px rgba(24, 24, 27, 0.08);
}

.preview-zoom-value {
  min-width: 34px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  user-select: none;
  -webkit-user-select: none;
}
</style>