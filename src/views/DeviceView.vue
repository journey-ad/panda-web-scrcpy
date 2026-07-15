<script setup>
import { mdiArrowTopRight, mdiChevronDoubleLeft, mdiChevronDoubleRight, mdiConsole, mdiGithub, mdiInformationOutline, mdiPackageVariantClosed, mdiPower, mdiRocketLaunchOutline, mdiTextBoxSearchOutline } from '@mdi/js'

import { ref, computed, onMounted, onUnmounted, shallowRef, watch, defineAsyncComponent } from "vue";
import { useDisplay } from "vuetify";
import PairedDevices from "../components/Device/PairedDevices.vue";
import logo from "../assets/logo.svg";
import AbstractList from "./AbstractList.vue";
import VideoContainer from "../components/Device/VideoContainer.vue";
import NavigationBar from "../components/Device/NavigationBar.vue";
import state from "../components/Scrcpy/scrcpy-state";
import ShareButton from '../components/Remote/ShareButton.vue'

const DeviceInfo = defineAsyncComponent(() => import("../components/Device/DeviceInfo.vue"));
const AppManager = defineAsyncComponent(() => import("../components/Device/AppManager.vue"));
const DeviceShell = defineAsyncComponent(() => import("../components/Device/DeviceShell.vue"));
const DeviceLogcat = defineAsyncComponent(() => import("../components/Device/DeviceLogcat.vue"));

const { width } = useDisplay();
/** 宽屏下是否具备显示右侧栏的条件 */
const canShowRightPanel = computed(() => width.value >= 960);
/** 用户手动收起右侧工具栏 */
const rightPanelCollapsed = ref(false);
/** 实际是否显示右侧栏与分隔条 */
const layoutShowsRightPanel = computed(
  () => canShowRightPanel.value && !rightPanelCollapsed.value
);

const containerSize = ref({ width: 0, height: 0 });
const userSetLeftPanelWidth = ref(560);
const leftPanelWidth = computed(() => {
  if (!layoutShowsRightPanel.value) {
    return containerSize.value.width > 0 ? containerSize.value.width : width.value;
  }
  return userSetLeftPanelWidth.value;
});

/** 小屏/单栏时用 100% 宽度，避免列布局下内联 px 与 flex 高度链断裂导致投屏区高度为 0 */
const leftPanelOuterStyle = computed(() => {
  if (!layoutShowsRightPanel.value) {
    return { width: "100%", boxSizing: "border-box" };
  }
  return { width: `${userSetLeftPanelWidth.value}px` };
});

const rightPanelWidth = computed(() =>
  Math.max(300, containerSize.value.width - leftPanelWidth.value - 16)
);
const isResizing = ref(false);
const startX = ref(0);
const startWidth = ref(0);

const deviceMeta = shallowRef(undefined);
const connected = ref(false);
const tab = ref(0);

const isHorizontalLayout = computed(() => {
  return containerSize.value.width > leftPanelWidth.value + 200;
});

const handleDisconnected = () => {
  connected.value = false;
  deviceMeta.value = undefined;
};

const onPairDevice = (device) => {
  deviceMeta.value = device;
};

const handleConnectionStatus = async (status) => {
  if (status) {
    await ensureContainerSize();
  }
  connected.value = status;
  if (!status) {
    handleDisconnected();
  }
};

const startResize = (e) => {
  if (!layoutShowsRightPanel.value) return;
  isResizing.value = true;
  startX.value = e.clientX || e.touches[0].clientX;
  startWidth.value = userSetLeftPanelWidth.value;
  document.addEventListener("mousemove", resize);
  document.addEventListener("touchmove", resize);
  document.addEventListener("mouseup", stopResize);
  document.addEventListener("touchend", stopResize);
};

const resize = (e) => {
  if (!isResizing.value) return;
  const clientX = e.clientX || e.touches[0]?.clientX;
  const diff = clientX - startX.value;
  userSetLeftPanelWidth.value = Math.max(
    300,
    Math.min(startWidth.value + diff, containerSize.value.width - 300)
  );
};

const stopResize = () => {
  isResizing.value = false;
  document.removeEventListener("mousemove", resize);
  document.removeEventListener("touchmove", resize);
  document.removeEventListener("mouseup", stopResize);
  document.removeEventListener("touchend", stopResize);
};

const containerRef = ref(null);
const DeviceContainerRef = ref(null);
const videoWrapperRef = ref(null);

const containerDimensions = computed(() => {
  /** 与 `.device-container` 中导航列宽 + gap 一致，无额外水平内边距 */
  const navColumnWidth = 56;
  const videoNavGap = 4;
  const canvasBorderTotal = 6;

  return {
    width:
      leftPanelWidth.value - (navColumnWidth + videoNavGap + canvasBorderTotal),
    height: containerSize.value.height - canvasBorderTotal,
  };
});

watch(
  () => containerDimensions.value,
  (newDimensions) => {
    if (videoWrapperRef.value) {
      videoWrapperRef.value.style.width = `${newDimensions.width}px`;
      videoWrapperRef.value.style.height = `${newDimensions.height}px`;
      state.updateVideoContainer();
    }
  },
  { immediate: true }
);

const updateContainerSize = () => {
  if (containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect();
    containerSize.value = {
      width: rect.width,
      height: rect.height,
    };
    if (videoWrapperRef.value) {
      videoWrapperRef.value.style.width = `${containerDimensions.value.width}px`;
      videoWrapperRef.value.style.height = `${containerDimensions.value.height}px`;
      if (state.running) {
        state.updateVideoContainer();
      }
    }
  }
};

const ensureContainerSize = () => {
  return new Promise(resolve => {
    const checkSize = () => {
      updateContainerSize();
      if (containerSize.value.width > 0 && containerSize.value.height > 0) {
        resolve();
      } else {
        requestAnimationFrame(checkSize);
      }
    };
    checkSize();
  });
};

onMounted(async () => {
  await ensureContainerSize();
  window.addEventListener('resize', updateContainerSize);
});

onUnmounted(() => {
  stopResize();
  window.removeEventListener("resize", updateContainerSize);
});

watch(
  () => document.fullscreenElement,
  (newValue) => {
    if (!newValue) {
      setTimeout(updateContainerSize, 100);
    }
  }
);

watch(width, (newWidth, oldWidth) => {
  if (newWidth < 960 && oldWidth >= 960) {
    userSetLeftPanelWidth.value = newWidth;
  } else if (newWidth >= 960 && oldWidth < 960) {
    userSetLeftPanelWidth.value = 450;
  }
});

const tabs = [
  { title: "基础信息", icon: mdiInformationOutline, component: DeviceInfo },
  { title: "应用管理", icon: mdiPackageVariantClosed, component: AppManager },
  { title: "终端", icon: mdiConsole, component: DeviceShell },
  { title: "Logcat", icon: mdiTextBoxSearchOutline, component: DeviceLogcat },
];

const pairedDevicesRef = ref(null);

const handleAddDevice = () => {
  pairedDevicesRef.value?.handleAddDevice();
};
</script>

<template>
  <v-app-bar
    flat
    height="48"
    color="surface"
    class="top-bar"
    app
  >
    <div class="bar-inner">
      <v-img
        :src="logo"
        max-width="22"
        max-height="22"
        class="flex-shrink-0"
      />
      <span class="brand-name">PANDASCRCPY</span>
      <div class="bar-devices">
        <PairedDevices
          ref="pairedDevicesRef"
          @pair-device="onPairDevice"
          @update-connection-status="handleConnectionStatus"
        />
      </div>
      <ShareButton v-if="connected" class="ml-1 flex-shrink-0" />
      <slot name="remote-button" />
      <v-spacer />
      <v-btn
        v-if="canShowRightPanel"
        icon
        variant="text"
        size="small"
        color="secondary"
        class="flex-shrink-0"
        :title="rightPanelCollapsed ? '展开侧栏' : '收起侧栏'"
        @click="rightPanelCollapsed = !rightPanelCollapsed"
      >
        <v-icon size="20" :icon=" rightPanelCollapsed ? mdiChevronDoubleLeft : mdiChevronDoubleRight " />
      </v-btn>
      <v-btn
        icon
        variant="text"
        size="small"
        color="secondary"
        href="https://github.com/pandatestgrid/panda-web-scrcpy"
        target="_blank"
        rel="noopener noreferrer"
        title="源码仓库"
      >
        <v-icon size="20" :icon="mdiGithub" />
      </v-btn>
      <a
        class="cta-btn d-none d-sm-inline-flex"
        href="https://www.pandatest.net/device"
        target="_blank"
        rel="noopener noreferrer"
        title="AI 助手、虚拟屏幕、设备群控、脚本录制回放、性能检测等"
      >
        <v-icon size="14" class="mr-1" :icon="mdiRocketLaunchOutline" />
        加强版 · 免费
        <v-icon size="12" class="ml-1" :icon="mdiArrowTopRight" />
      </a>
    </div>
  </v-app-bar>

  <v-main class="main-area">
    <div
      ref="containerRef"
      class="layout"
      :class="{ 'horizontal-layout': isHorizontalLayout }"
    >
      <div class="left-panel" :style="leftPanelOuterStyle">
        <div class="panel-card">
          <div class="panel-inner">
            <div
              v-if="connected"
              ref="DeviceContainerRef"
              class="device-container"
            >
              <div
                ref="videoWrapperRef"
                class="video-wrapper"
                :style="{
                  width: `${containerDimensions.width}px`,
                  height: `${containerDimensions.height}px`
                }"
              >
                <VideoContainer />
              </div>
              <div class="navigation-wrapper">
                <NavigationBar />
              </div>
            </div>
            <div v-else class="empty-state-wrap">
              <div class="empty-state">
                <div class="empty-state-icon">
                  <v-progress-circular
                    v-if="state.connecting"
                    indeterminate
                    color="primary"
                    size="48"
                    width="3"
                  />
                  <v-btn
                    v-else
                    icon
                    size="56"
                    color="primary"
                    class="power-btn"
                    @click="handleAddDevice"
                  >
                    <v-icon size="28" :icon="mdiPower" />
                  </v-btn>
                </div>
                <p class="empty-state-title">
                  {{ state.connecting ? '正在连接...' : '连接设备' }}
                </p>
                <p class="empty-state-desc">
                  {{ state.connecting ? '请稍候' : '确保设备已开启 USB 调试模式' }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div
        v-if="layoutShowsRightPanel"
        class="resizer"
        @mousedown="startResize"
        @touchstart="startResize"
      />
      <div
        v-if="layoutShowsRightPanel"
        class="right-panel"
        :style="{ width: rightPanelWidth + 'px' }"
      >
        <div class="panel-card right-card">
          <template v-if="connected">
            <div class="tab-bar">
              <button
                v-for="(item, index) in tabs"
                :key="index"
                :class="['tab-item', { active: tab === index }]"
                @click="tab = index"
              >
                <v-icon size="14" :icon=" item.icon " />
                <span>{{ item.title }}</span>
              </button>
            </div>
            <v-window v-model="tab" class="tab-content">
              <v-window-item
                v-for="(item, index) in tabs"
                :key="index"
                :value="index"
              >
                <component :is="item.component" :device-meta="deviceMeta" />
              </v-window-item>
            </v-window>
          </template>
          <template v-else>
            <AbstractList />
          </template>
        </div>
      </div>
    </div>
  </v-main>

</template>

<style lang="scss" scoped>
.top-bar {
  border-bottom: 1px solid var(--border) !important;
}

.bar-inner {
  display: flex;
  align-items: center;
  flex-grow: 1;
  gap: 8px;
  padding: 0 12px;
  max-width: 100%;
}

.brand-name {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: rgba(24, 24, 27, 0.85);
  white-space: nowrap;
  user-select: none;
}

.bar-devices {
  flex: 1 1 auto;
  min-width: 0;
}

.cta-btn {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: var(--cta-bg);
  text-decoration: none;
  white-space: nowrap;
  transition: all 0.2s ease;
  letter-spacing: 0.01em;
  line-height: 1;

  &:hover {
    background: var(--cta-hover);
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
    transform: translateY(-1px);
  }
}

.main-area {
  background: rgb(var(--v-theme-background));
}

.layout {
  display: flex;
  height: calc(100vh - 48px);
  overflow: hidden;

  &.horizontal-layout {
    flex-direction: row;
  }
}

.left-panel {
  min-width: 200px;
  max-width: 100%;
  overflow: hidden;
  padding: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.right-panel {
  flex: 1 1 0;
  min-width: 300px;
  min-height: 0;
  padding: 0 4px 6px 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-card {
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--border);
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}

.panel-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 0;
  box-sizing: border-box;
}

.right-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tab-bar {
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--border);
  background: rgb(var(--v-theme-surface));
  height: 36px;
}

.tab-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  border: none;
  background: none;
  cursor: pointer;
  position: relative;
  transition: color 0.15s ease;
  white-space: nowrap;

  &:hover {
    color: rgba(24, 24, 27, 0.85);
    background: rgba(24, 24, 27, 0.03);
  }

  &.active {
    color: rgb(var(--v-theme-primary));

    &::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 16px;
      right: 16px;
      height: 2px;
      background: rgb(var(--v-theme-primary));
      
    }
  }
}

.tab-content {
  position: relative;
  flex: 1 1 0;
  min-height: 0;

  :deep(.v-window__container) {
    position: absolute !important;
    inset: 0;
  }

  :deep(.v-window-item) {
    height: 100%;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 0;
    margin: 0;
  }

  :deep(.v-window-item > *) {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
  }
}

.resizer {
  flex-shrink: 0;
  align-self: stretch;
  width: 6px;
  margin: 10px 0;
  box-sizing: border-box;
  cursor: col-resize;
  display: flex;
  justify-content: center;
  align-items: stretch;
  user-select: none;
  touch-action: none;

  &::before {
    content: '';
    width: 1px;
    flex-shrink: 0;
    background-color: var(--border-hover);
    transition: width 0.12s ease, background-color 0.12s ease;
  }

  &:hover::before,
  &:active::before {
    width: 2px;
    background-color: rgba(24, 24, 27, 0.22);
  }
}

.empty-state-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgb(var(--v-theme-background));
  text-align: center;
  gap: 8px;
  width: 100%;
  height: 100%;
}

.empty-state-icon {
  margin-bottom: 8px;
}

.power-btn {
  transition: box-shadow 0.2s ease;

  &:hover {
    box-shadow: 0 4px 16px rgba(24, 24, 27, 0.12);
  }
}

.empty-state-title {
  font-size: 16px;
  font-weight: 600;
  color: rgba(24, 24, 27, 0.85);
  margin: 0;
}

.empty-state-desc {
  font-size: 13px;
  color: var(--muted);
  margin: 0;
  max-width: 260px;
}

.device-container {
  display: flex;
  flex-direction: row;
  width: 100%;
  height: 100%;
  padding: 0;
  gap: 4px;
  box-sizing: border-box;
  background: transparent;
}

.video-wrapper {
  position: relative;
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  background: transparent;
  overflow: visible;
  box-sizing: border-box;
  transition: none !important;
}

.navigation-wrapper {
  width: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
}

@media (max-width: 959px) {
  .layout {
    flex-direction: column;
    min-height: 0;
  }

  .left-panel {
    flex: 1 1 0;
    min-height: 0;
    max-width: 100%;
    padding: 0;
  }

  .right-panel {
    padding: 0 6px 10px;
  }

  .resizer {
    display: none;
  }
}

</style>
