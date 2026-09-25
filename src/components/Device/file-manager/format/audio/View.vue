<script setup lang="ts">
// 库自带样式，与该懒加载块一起打包
import '@arraypress/waveform-player/dist/waveform-player.css';
import { nextTick, onUnmounted, ref } from 'vue';

import { mimeOf } from '../../model/mime';
import { readEntry } from '../../service/readEntry';
import { usePreviewScope } from '../../ui/preview/usePreviewScope';
import type { FileEntry } from '../../model/types';

const props = defineProps<{ entry: FileEntry }>();
const emit = defineEmits<{ (e: 'error', message: string): void }>();

const { signal, done, fail } = usePreviewScope((message) => emit('error', message));

type Player = import('@arraypress/waveform-player/no-autoinit').WaveformPlayer;

/** 波形高度，条宽 2px + 间距 1px 在 860px 内可容纳近 300 条 */
const WAVE_HEIGHT = 72;

const host = ref<HTMLElement | null>(null);
const url = ref('');
/** 从设备完整读取的进度，波形解码期间显示播放器自带的遮罩 */
const progress = ref(0);

let player: Player | null = null;

const mount = async (src: string) => {
  // 使用 no-autoinit 入口，只初始化带 data-waveform-player 标记的元素
  const { default: WaveformPlayer } = await import('@arraypress/waveform-player/no-autoinit');
  if (done() || !host.value) return;
  player = new WaveformPlayer(host.value, {
    url: src,
    // 不传的话会从 URL 推断标题，而这里是 blob:，只能得到乱码
    title: props.entry.name,
    colorPreset: 'light',
    waveformStyle: 'mirror',
    height: WAVE_HEIGHT,
    barWidth: 2,
    barSpacing: 1,
    barRadius: 1,
    waveformColor: '#cbd5e1',
    progressColor: '#6366f1',
    buttonSize: 40,
    // 默认 7 档过于密集，只保留常用的四档
    playbackRates: [0.5, 1, 2, 3],
    showHoverTime: true,
    showPlaybackSpeed: true,
    // 设备音频另有播放链路，不接管系统媒体会话
    enableMediaSession: false,
    seekLabel: '播放进度',
    playPauseLabel: '播放 / 暂停',
    speedLabel: '播放速度',
    errorText: '无法解析该音频',
    // 波形解码完成后自动播放，浏览器拦截时保持暂停
    onLoad: (instance) => void instance.play()?.catch(() => {}),
  });
};

const load = async () => {
  const { entry } = props;
  try {
    const bytes = await readEntry(entry, { signal, onProgress: (value) => (progress.value = value) });
    if (done()) return;
    url.value = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeOf(entry.name) }));
    // 宿主元素加入 DOM 后再构造，播放器要按容器宽度确定画布尺寸
    await nextTick();
    await mount(url.value);
  } catch (error) {
    fail(error);
  }
};

load();

onUnmounted(() => {
  player?.destroy();
  player = null;
  if (url.value) URL.revokeObjectURL(url.value);
});
</script>

<template>
  <div v-if="url" class="preview-audio">
    <div ref="host"></div>
  </div>
  <div v-else class="preview-hint">正在读取音频 {{ Math.round(progress * 100) }}%</div>
</template>

<style scoped>
.preview-audio {
  width: 100%;
  max-width: 860px;
  padding: 18px 20px 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 20px 25px -5px rgba(24, 24, 27, 0.06);
  --waveform-body-gap: 10px;
  --waveform-track-gap: 14px;
}

.preview-audio :deep(.waveform-player) {
  --wfp-accent: rgb(99, 102, 241);
  --wfp-text-color: rgba(24, 24, 27, 0.85);
  --wfp-text-secondary-color: rgba(24, 24, 27, 0.45);
}

.preview-audio :deep(.waveform-title) {
  font-size: 13px;
}

.preview-audio :deep(.waveform-btn) {
  border-color: #334155;
  background: #334155;
  color: #fff;
}

.preview-audio :deep(.waveform-btn:hover:not(:disabled)) {
  border-color: #0f172a;
  background: #0f172a;
}

.preview-audio :deep(.speed-btn) {
  min-width: 44px;
  padding: 4px 8px;
  border-color: rgba(51, 65, 85, 0.14);
  border-radius: 6px;
  color: #64748b;
  font-size: 12px;
}

.preview-audio :deep(.speed-btn:hover) {
  border-color: rgba(51, 65, 85, 0.24);
  background: rgba(24, 24, 27, 0.04);
}

.preview-audio :deep(.speed-menu) {
  padding: 4px;
  border-color: var(--border);
  border-radius: 8px;
  background: #fff;
  box-shadow: var(--menu-shadow);
}

.preview-audio :deep(.speed-option) {
  border-radius: 6px;
  color: rgba(24, 24, 27, 0.8);
  font-size: 12px;
}

.preview-audio :deep(.speed-option:hover) {
  background: rgba(24, 24, 27, 0.06);
  color: rgba(24, 24, 27, 0.9);
}

.preview-audio :deep(.speed-option.active) {
  background: var(--menu-active);
  color: #4f46e5;
}

.preview-audio :deep(.waveform-loading) {
  background: rgba(24, 24, 27, 0.04);
}

.preview-audio :deep(.waveform-error) {
  background: rgba(24, 24, 27, 0.04);
}

.preview-audio :deep(.waveform-error-text) {
  color: var(--muted);
}
</style>