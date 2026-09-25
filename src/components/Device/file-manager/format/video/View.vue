<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

import { deviceFileSource, ensureDeviceFileService, probeDeviceFile } from '../../device/device-file';
import type { FileEntry } from '../../model/types';
import { errorText } from '../../shared/utils';

const props = defineProps<{ entry: FileEntry }>();
const emit = defineEmits<{ (e: 'error', message: string): void }>();

const videoEl = ref<HTMLVideoElement | null>(null);

type VideoPlayer = ReturnType<(typeof import('video.js'))['default']>;

let player: VideoPlayer | null = null;
let cancelled = false;

const mountPlayer = async () => {
  const [{ default: videojs }] = await Promise.all([import('video.js'), import('video.js/dist/video-js.css')]);
  if (cancelled || !videoEl.value) throw new Error('播放器初始化失败');
  player = videojs(videoEl.value, {
    controls: true,
    preload: 'auto',
    autoplay: true,
    // 填满容器由 CSS 控制，画面等比缩放到容器内，不按 16:9 拉高外层
    fill: true,
    playsinline: true,
    html5: { nativeAudioTracks: false, nativeVideoTracks: false },
  });
};

/**
 * 交给 Service Worker 代理，播放器自己按需发 Range 请求
 * 手机拍摄的 MP4 是普通封装，moov 里没有 mvex，MediaSource 追加必然失败，
 * 只能走浏览器原生 demuxer
 */
const start = async () => {
  const scope = await ensureDeviceFileService();
  if (cancelled) return;
  if (!scope) throw new Error('当前环境不支持在线预览，请下载后播放');
  const { src, type } = deviceFileSource(scope, props.entry);
  if (!(await probeDeviceFile(src))) throw new Error('播放通道暂时不可用，请稍后重试或下载后播放');
  if (cancelled) return;
  player!.src({ src, type });
};

onMounted(async () => {
  try {
    await mountPlayer();
    await start();
  } catch (error) {
    if (!cancelled) emit('error', errorText(error));
  }
});

onUnmounted(() => {
  cancelled = true;
  player?.dispose();
  player = null;
});
</script>

<template>
  <div class="preview-video">
    <div class="preview-video-host">
      <video ref="videoEl" class="video-js" playsinline />
    </div>
  </div>
</template>

<style scoped>
.preview-video {
  display: flex;
  flex-direction: column;
  align-self: stretch;
  width: 100%;
  min-height: 0;
  overflow: hidden;
}

.preview-video-host {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
}

.preview-video-host :deep(.video-js) {
  width: 100%;
  height: 100%;
  font-size: 12px;
}

.preview-video-host :deep(.video-js video) {
  object-fit: contain;
}
</style>
