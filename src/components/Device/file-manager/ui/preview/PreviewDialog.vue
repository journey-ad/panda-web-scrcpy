<script setup lang="ts">
import { mdiChevronLeft, mdiChevronRight, mdiClose, mdiDownload, mdiFullscreen, mdiFullscreenExit } from '@mdi/js';
import { computed, h, ref, toRef, watch } from 'vue';

import { isMedia, resolvePreview, viewOf, withinLimit } from '../../format/registry';
import { readRange } from '../../device/device-file';
import { useSettings } from '../../shared/settings';
import { provideHeadActions } from './useHeadActions';
import type { FileEntry, PreviewKind } from '../../model/types';

const props = defineProps<{ modelValue: boolean; entry: FileEntry | null; entries: FileEntry[] }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'update:entry', entry: FileEntry): void;
  (e: 'download', entry: FileEntry): void;
  (e: 'extract', entry: FileEntry): void;
  (e: 'error', message: string): void;
  (e: 'closed'): void;
}>();

/** 小窗尺寸所有类型共用 */
const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 720;

const prefs = useSettings();
const fullscreen = toRef(prefs, 'previewFullscreen');

/** 各类型自带的按钮传送到这里，排在标题右侧、图标按钮之前 */
const headActions = ref<HTMLElement | null>(null);
provideHeadActions(headActions);

const toggleFullscreen = () => {
  fullscreen.value = !fullscreen.value;
};

/** 扩展名判不出类型时读这一段文件头补充判断 */
const SNIFF_BYTES = 64;
const head = ref<Uint8Array | null>(null);

/** 文件头读回来之前只能按扩展名判定 */
const kind = computed(() => (props.entry ? resolvePreview(props.entry.name, head.value) : null));

/** 信息面板里选定的预览类型，只作用于当前文件 */
const override = ref<PreviewKind | null>(null);

/** 判不出类型、或体积超过该类型预览上限的文件，都退到信息面板 */
const type = computed(() => {
  const found = override.value ?? kind.value;
  return found && withinLimit(found, props.entry?.size ?? 0) ? found : null;
});

/** 预览组件按 entry.preview 选渲染分支，切换后要带上判出的类型 */
const target = computed(() =>
  props.entry && override.value ? { ...props.entry, preview: override.value } : props.entry
);

/** 扩展名判不出类型时先读文件头，未读出前显示识别占位 */
const identifying = ref(false);
const Identifying = () => h('div', { class: 'preview-hint' }, '正在识别格式…');

/** 渲染组件由插件自带，没有对应组件时改用默认面板 */
const view = computed(() => (identifying.value ? Identifying : viewOf(type.value)));

/** 换文件时重新识别格式，首次打开也要识别，因此立即执行一次 */
watch(
  () => props.entry?.path,
  async () => {
    head.value = null;
    override.value = null;
    const entry = props.entry;
    identifying.value = !!entry && !entry.preview;
    if (!entry || entry.preview) return;
    try {
      head.value = await readRange(entry.path, 0, SNIFF_BYTES);
    } catch {
      /* 无法读取文件头时按文件信息展示 */
    } finally {
      identifying.value = false;
    }
  },
  { immediate: true }
);

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

/** 小窗高度走 Vuetify 的 --v-card-height，全屏时交给默认的 100% */
const cardStyle = computed(() => (fullscreen.value ? {} : { '--v-card-height': `min(${WINDOW_HEIGHT}px, 88vh)` }));

const onError = (message: string) => {
  open.value = false;
  emit('error', `预览失败：${message}`);
};

/** 解压由外层发起：确认弹窗与任务队列都在文件管理里 */
const onExtract = () => {
  if (props.entry) emit('extract', props.entry);
};

/** 信息面板认出可预览的格式时，改用该类型的渲染组件 */
const onPreview = (value: PreviewKind) => {
  override.value = value;
};

/** 当前目录里的媒体文件，顺序与列表一致，供上一个/下一个循环切换 */
const media = computed(() => props.entries.filter((entry) => !!entry.preview && isMedia(entry.preview)));

const mediaIndex = computed(() => {
  const path = props.entry?.path;
  return path ? media.value.findIndex((item) => item.path === path) : -1;
});

const steppable = computed(() => media.value.length > 1 && mediaIndex.value >= 0);

const step = (delta: number) => {
  const list = media.value;
  if (!steppable.value) return;
  emit('update:entry', list[(mediaIndex.value + delta + list.length) % list.length]);
};
</script>

<template>
  <v-dialog
    v-model="open"
    :fullscreen="fullscreen"
    :width="fullscreen ? undefined : WINDOW_WIDTH"
    @after-leave="emit('closed')"
  >
    <v-card class="preview-card" :style="cardStyle">
      <div class="preview-head">
        <span class="preview-title">{{ entry?.name }}</span>

        <!-- 自定义预览按钮 -->
        <span ref="headActions" class="preview-head-actions" />

        <v-btn
          icon
          variant="text"
          size="small"
          title="下载到本机"
          :disabled="!entry"
          @click="entry && emit('download', entry)"
        >
          <v-icon size="18" :icon="mdiDownload" />
        </v-btn>
        <v-btn
          icon
          variant="text"
          size="small"
          :title="fullscreen ? '切换为小窗口' : '全屏显示'"
          @click="toggleFullscreen"
        >
          <v-icon size="18" :icon="fullscreen ? mdiFullscreenExit : mdiFullscreen" />
        </v-btn>
        <v-btn icon variant="text" size="small" title="关闭" @click="open = false">
          <v-icon size="18" :icon="mdiClose" />
        </v-btn>
      </div>
      <div class="preview-stage">
        <v-card-text class="preview-body">
          <!-- 预览内容 -->
          <component
            :is="view"
            v-if="view"
            :key="entry?.path"
            :entry="target"
            @extract="onExtract"
            @preview="onPreview"
            @error="onError"
          />
        </v-card-text>

        <template v-if="steppable">
          <button type="button" class="preview-step prev" title="上一个" @click="step(-1)">
            <v-icon size="24" :icon="mdiChevronLeft" />
          </button>
          <button type="button" class="preview-step next" title="下一个" @click="step(1)">
            <v-icon size="24" :icon="mdiChevronRight" />
          </button>
        </template>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.preview-card {
  display: flex;
  flex-direction: column;
}

.preview-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 8px 8px 16px;
}

.preview-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  color: rgba(24, 24, 27, 0.85);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-head-actions {
  display: contents;
}

.preview-head :deep(.preview-head-action) {
  flex-shrink: 0;
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 500;
  text-transform: none;
}

.preview-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}

.preview-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 30px 16px 16px;
  overflow: auto;
}

.preview-step {
  position: absolute;
  top: 50%;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  transform: translateY(-50%);
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 2px 8px rgba(24, 24, 27, 0.18);
  color: rgba(24, 24, 27, 0.75);
  cursor: pointer;
  transition: background 0.15s;
}

.preview-step:hover {
  background: #fff;
}

.preview-step.prev {
  left: 8px;
}

.preview-step.next {
  right: 8px;
}

.preview-body :deep(.preview-hint) {
  padding: 24px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}

.preview-body :deep(.preview-note) {
  align-self: stretch;
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted);
}
</style>
