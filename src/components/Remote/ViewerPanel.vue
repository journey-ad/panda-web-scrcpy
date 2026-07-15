<template>
  <div class="viewer-panel">
    <div v-if="!isConnected" class="connection-form">
      <div class="connect-card">
        <div class="cc-header">
          <v-icon size="20" color="secondary" class="mr-2" :icon="mdiCastConnected" />
          <span class="cc-title">远程观看</span>
        </div>
        <div class="cc-body">
          <v-text-field
            v-model="hostPeerId"
            label="分享 ID"
            placeholder="输入分享端的 Peer ID"
            :disabled="connectionState === 'connecting'"
            :error-messages="error || undefined"
            hide-details="auto"
            @keyup.enter="handleConnect"
          />
        </div>
        <div class="cc-actions">
          <v-spacer />
          <v-btn
            color="primary"
            size="small"
            :loading="connectionState === 'connecting'"
            :disabled="!hostPeerId.trim()"
            @click="handleConnect"
          >
            <v-icon start size="16" :icon="mdiConnection" />
            连接
          </v-btn>
        </div>
      </div>
    </div>

    <div v-else class="video-area">
      <div class="status-bar">
        <span class="status-chip">
          <span class="status-dot" />
          已连接
        </span>
        <v-spacer />
        <v-btn
          variant="text"
          size="x-small"
          color="error"
          class="text-none"
          @click="handleDisconnect"
        >
          <v-icon start size="14" :icon="mdiClose" />
          断开
        </v-btn>
      </div>

      <div class="video-wrapper" ref="videoWrapper">
        <video
          ref="videoElement"
          autoplay
          playsinline
          muted
          class="remote-video"
          @pointerdown="touchController.onPointerDown"
          @pointermove="touchController.onPointerMove"
          @pointerup="touchController.onPointerUp"
          @pointercancel="touchController.onPointerCancel"
        />
      </div>

      <div class="nav-bar">
        <button class="nav-btn" @click="touchController.sendBackKey">
          <v-icon size="20" :icon="mdiArrowLeft" />
        </button>
        <button class="nav-btn" @click="touchController.sendHomeKey">
          <v-icon size="20" :icon="mdiCircleOutline" />
        </button>
        <button class="nav-btn" @click="touchController.sendRecentsKey">
          <v-icon size="20" :icon="mdiSquareOutline" />
        </button>
      </div>
    </div>

    <v-snackbar v-model="showError" color="error" timeout="5000">
      {{ error }}
      <template v-slot:actions>
        <v-btn variant="text" size="small" @click="showError = false">关闭</v-btn>
      </template>
    </v-snackbar>

    <v-snackbar v-model="showDisconnected" color="warning" timeout="3000">
      连接已断开
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { mdiArrowLeft, mdiCastConnected, mdiCircleOutline, mdiClose, mdiConnection, mdiSquareOutline } from '@mdi/js'

import { ref, watch, onMounted } from 'vue';
import { useScreenViewer } from '@/composables/use-screen-viewer';
import { useTouchController } from '@/composables/use-touch-controller';

const props = defineProps<{
  initialPeerId?: string;
}>();

const hostPeerId = ref('');
const showError = ref(false);
const showDisconnected = ref(false);
const videoElement = ref<HTMLVideoElement | null>(null);
const videoWrapper = ref<HTMLDivElement | null>(null);

const {
  isConnected,
  connectionState,
  error,
  remoteStream,
  connect,
  disconnect,
  sendCommand,
} = useScreenViewer();

const touchController = useTouchController(sendCommand, videoElement);

onMounted(() => {
  if (props.initialPeerId) {
    hostPeerId.value = props.initialPeerId;
    setTimeout(() => {
      handleConnect();
    }, 500);
  }
});

watch(error, (newError) => {
  if (newError) showError.value = true;
});

watch(connectionState, (newState, oldState) => {
  if (oldState === 'connected' && newState === 'disconnected') {
    showDisconnected.value = true;
  }
});

function bindStreamToVideo() {
  if (videoElement.value && remoteStream.value) {
    videoElement.value.srcObject = remoteStream.value;
    videoElement.value.play().catch((err) => {
      console.warn('[ViewerPanel] 视频自动播放失败:', err);
    });
  }
}

watch(remoteStream, bindStreamToVideo);
watch(videoElement, bindStreamToVideo);

async function handleConnect() {
  if (!hostPeerId.value.trim()) return;
  try {
    await connect(hostPeerId.value.trim());
  } catch (err) {
    console.error('连接失败:', err);
  }
}

function handleDisconnect() {
  disconnect();
  hostPeerId.value = '';
}
</script>

<style scoped>
.viewer-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.connection-form {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  padding: 16px;
}

.connect-card {
  max-width: 400px;
  width: 100%;
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.cc-header {
  display: flex;
  align-items: center;
  padding: 16px 16px 0;
  font-size: 15px;
  font-weight: 600;
  color: rgba(24, 24, 27, 0.85);
}

.cc-title {
  font-size: 15px;
  font-weight: 600;
}

.cc-body {
  padding: 16px 16px 8px;
}

.cc-actions {
  display: flex;
  align-items: center;
  padding: 8px 16px 16px;
}

.video-area {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.status-bar {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #16a34a;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22c55e;
}

.video-wrapper {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #18181b;
  overflow: hidden;
  touch-action: none;
}

.remote-video {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  touch-action: none;
}

.nav-bar {
  display: flex;
  justify-content: space-around;
  padding: 8px 16px;
  border-top: 1px solid var(--border);
}

.nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(24, 24, 27, 0.6);
  cursor: pointer;
  transition: background 0.15s;
}

.nav-btn:hover {
  background: rgba(24, 24, 27, 0.06);
}
</style>
